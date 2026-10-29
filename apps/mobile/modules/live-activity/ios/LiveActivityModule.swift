// Live Activities of followed trains (ActivityKit) and the commute widget's
// data in the App Group. JS side: modules/live-activity/index.ts.

import ActivityKit
import ExpoModulesCore
import Foundation
import WidgetKit

/// Shared with the widget extension (targets/widgets/CommuteWidget.swift)
private let appGroup = "group.info.megisholavonat.app"
private let commuteKey = "commute"

enum LiveActivityError: Error, CustomStringConvertible {
    case unsupported
    case invalid(String)

    var description: String {
        switch self {
        case .unsupported: return "Live Activities are not available"
        case let .invalid(what): return "Invalid \(what)"
        }
    }
}

/// JS object -> Decodable, through JSON
private func decode<T: Decodable>(_ type: T.Type, _ value: [String: Any], _ what: String) throws -> T {
    guard JSONSerialization.isValidJSONObject(value) else { throw LiveActivityError.invalid(what) }
    let data = try JSONSerialization.data(withJSONObject: value)
    do {
        return try JSONDecoder().decode(type, from: data)
    } catch {
        throw LiveActivityError.invalid(what)
    }
}

private func hex(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
}

private func staleDate(_ seconds: Double?) -> Date? {
    seconds.map { Date(timeIntervalSince1970: $0) }
}

public class LiveActivityModule: Module {
    /// Activities whose push token and state are being watched
    private var watched = Set<String>()

    public func definition() -> ModuleDefinition {
        Name("LiveActivity")

        Events("onPushToken", "onEnd")

        OnCreate {
            if #available(iOS 16.2, *) {
                for activity in Activity<TrainActivityAttributes>.activities {
                    self.watch(activity)
                }
            }
        }

        /// The user allows Live Activities for the app
        Function("isEnabled") { () -> Bool in
            if #available(iOS 16.2, *) {
                return ActivityAuthorizationInfo().areActivitiesEnabled
            }
            return false
        }

        /// Running activities: [{ id, followId, token }]
        Function("list") { () -> [[String: Any]] in
            if #available(iOS 16.2, *) {
                return Activity<TrainActivityAttributes>.activities
                    .filter { $0.activityState == .active || $0.activityState == .stale }
                    .map { activity in
                        var item: [String: Any] = [
                            "id": activity.id,
                            "followId": activity.attributes.followId,
                        ]
                        if let token = activity.pushToken { item["token"] = hex(token) }
                        return item
                    }
            }
            return []
        }

        /// Starts an activity with push updates; returns its id.
        AsyncFunction("start") { (attributes: [String: Any], state: [String: Any], stale: Double?) -> String in
            guard #available(iOS 16.2, *) else { throw LiveActivityError.unsupported }
            let attrs = try decode(TrainActivityAttributes.self, attributes, "attributes")
            let content = try decode(TrainActivityAttributes.ContentState.self, state, "state")
            let activity = try Activity.request(
                attributes: attrs,
                content: ActivityContent(state: content, staleDate: staleDate(stale)),
                pushType: .token
            )
            self.watch(activity)
            return activity.id
        }

        AsyncFunction("update") { (id: String, state: [String: Any], stale: Double?) in
            guard #available(iOS 16.2, *) else { throw LiveActivityError.unsupported }
            let content = try decode(TrainActivityAttributes.ContentState.self, state, "state")
            guard let activity = Activity<TrainActivityAttributes>.activities.first(where: { $0.id == id }) else {
                return
            }
            await activity.update(ActivityContent(state: content, staleDate: staleDate(stale)))
        }

        /// Ends an activity; it stays on the lock screen a while unless
        /// `immediately`.
        AsyncFunction("end") { (id: String, state: [String: Any]?, immediately: Bool) in
            guard #available(iOS 16.2, *) else { throw LiveActivityError.unsupported }
            guard let activity = Activity<TrainActivityAttributes>.activities.first(where: { $0.id == id }) else {
                return
            }
            let content = try state.map {
                ActivityContent(state: try decode(TrainActivityAttributes.ContentState.self, $0, "state"), staleDate: nil)
            }
            await activity.end(content, dismissalPolicy: immediately ? .immediate : .default)
        }

        /// The commute widget's data (JSON), then a timeline reload.
        Function("setWidgetData") { (json: String) in
            let defaults = UserDefaults(suiteName: appGroup)
            if defaults?.string(forKey: commuteKey) == json { return }
            defaults?.set(json, forKey: commuteKey)
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    @available(iOS 16.2, *)
    private func watch(_ activity: Activity<TrainActivityAttributes>) {
        guard !watched.contains(activity.id) else { return }
        watched.insert(activity.id)
        let id = activity.id
        let followId = activity.attributes.followId
        Task { [weak self] in
            for await token in activity.pushTokenUpdates {
                self?.sendEvent("onPushToken", ["id": id, "followId": followId, "token": hex(token)])
            }
        }
        Task { [weak self] in
            for await state in activity.activityStateUpdates where state == .ended || state == .dismissed {
                self?.watched.remove(id)
                self?.sendEvent("onEnd", ["id": id, "followId": followId])
                break
            }
        }
    }
}
