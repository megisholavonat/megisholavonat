// Watches the ActivityKit tokens from launch on, also when iOS wakes the app
// in the background after starting a Live Activity by push (iOS 17.2+), and
// hands them to the API itself: the JS runtime may not run then.
//
// - The push-to-start token (a device's, rotates): `liveactivity_start`
// - Each activity's own push token, wherever it was started from:
//   `liveactivity` for its follow, so the API's updates and end reach it
//
// The API base URL and the device's bearer token come from JS
// (`configureApi`) and are kept in the Keychain.

import ActivityKit
import Foundation
import Security
import UIKit

func hexString(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
}

struct ApiConfig: Codable, Equatable {
    /// e.g. https://megisholavonat.info/api
    var url: String
    /// `<deviceId>.<token>`
    var auth: String
}

/// The API config in the Keychain, readable after the first unlock (a
/// background launch while the phone is locked).
enum ApiConfigStore {
    private static let service = "info.megisholavonat.app.live-activity"
    private static let account = "api"

    private static var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    static func load() -> ApiConfig? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return try? JSONDecoder().decode(ApiConfig.self, from: data)
    }

    static func save(_ config: ApiConfig) {
        guard let data = try? JSONEncoder().encode(config) else { return }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        if SecItemUpdate(query as CFDictionary, attributes as CFDictionary) == errSecItemNotFound {
            var q = query
            q.merge(attributes) { $1 }
            SecItemAdd(q as CFDictionary, nil)
        }
    }
}

@MainActor
final class LiveActivityObserver {
    static let shared = LiveActivityObserver()

    /// Events for JS (LiveActivityModule), when it runs
    var listener: ((String, [String: Any]) -> Void)?

    private static let startTokenKey = "liveActivity.pushToStartToken"

    private var started = false
    private var watched = Set<String>()
    /// Activity id -> (follow id, token) last seen
    private var tokens: [String: (followId: String, token: String)] = [:]
    /// `<auth>|<type>|<token>|<follow>` registered with the API
    private var posted = Set<String>()
    private var config = ApiConfigStore.load()

    /// The latest push-to-start token, hex
    var pushToStartToken: String? {
        UserDefaults.standard.string(forKey: Self.startTokenKey)
    }

    /// From launch on; again from the module is harmless.
    func start() {
        guard !started else { return }
        started = true
        guard #available(iOS 16.2, *) else { return }
        for activity in Activity<TrainActivityAttributes>.activities {
            watch(activity)
        }
        Task { @MainActor [weak self] in
            for await activity in Activity<TrainActivityAttributes>.activityUpdates {
                self?.watch(activity)
            }
        }
        if #available(iOS 17.2, *) {
            Task { @MainActor [weak self] in
                for await data in Activity<TrainActivityAttributes>.pushToStartTokenUpdates {
                    self?.gotStartToken(hexString(data))
                }
            }
        }
    }

    func configure(_ next: ApiConfig) {
        if config != next {
            config = next
            ApiConfigStore.save(next)
        }
        // A new device (or the first config) gets the tokens known so far
        if let token = pushToStartToken {
            post(type: "liveactivity_start", token: token, followId: nil)
        }
        for (followId, token) in tokens.values {
            post(type: "liveactivity", token: token, followId: followId)
        }
    }

    @available(iOS 16.2, *)
    func watch(_ activity: Activity<TrainActivityAttributes>) {
        guard !watched.contains(activity.id) else { return }
        watched.insert(activity.id)
        let id = activity.id
        let followId = activity.attributes.followId
        Task { @MainActor [weak self] in
            for await data in activity.pushTokenUpdates {
                let token = hexString(data)
                self?.tokens[id] = (followId, token)
                self?.post(type: "liveactivity", token: token, followId: followId)
                self?.listener?("onPushToken", ["id": id, "followId": followId, "token": token])
            }
        }
        Task { @MainActor [weak self] in
            for await state in activity.activityStateUpdates where state == .ended || state == .dismissed {
                self?.watched.remove(id)
                self?.tokens[id] = nil
                self?.listener?("onEnd", ["id": id, "followId": followId])
                break
            }
        }
    }

    private func gotStartToken(_ token: String) {
        UserDefaults.standard.set(token, forKey: Self.startTokenKey)
        post(type: "liveactivity_start", token: token, followId: nil)
        listener?("onPushToStartToken", ["token": token])
    }

    /// POST /v1/devices/me/push-tokens; best effort, JS registers again.
    private func post(type: String, token: String, followId: String?) {
        guard let config, let url = URL(string: config.url + "/v1/devices/me/push-tokens") else { return }
        let key = [config.auth, type, token, followId ?? ""].joined(separator: "|")
        guard !posted.contains(key) else { return }
        posted.insert(key)

        var body: [String: String] = ["type": type, "token": token]
        if let followId { body["followId"] = followId }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(config.auth)", forHTTPHeaderField: "Authorization")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        // Finish even if the app was only woken for the token
        let application = UIApplication.shared
        var task = UIBackgroundTaskIdentifier.invalid
        task = application.beginBackgroundTask(withName: "push-token") {
            application.endBackgroundTask(task)
        }
        URLSession.shared.dataTask(with: request) { _, response, error in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            Task { @MainActor in
                // Retried with the next config or token, except for a
                // follow the API doesn't know
                if error != nil || (status >= 300 && status != 404) {
                    self.posted.remove(key)
                }
                application.endBackgroundTask(task)
            }
        }.resume()
    }
}
