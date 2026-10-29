import ExpoModulesCore
import UIKit

/// Starts watching the Live Activity tokens at launch, before (or without)
/// the JS runtime: iOS wakes the app in the background after starting an
/// activity by push, and its token must reach the API then.
public class LiveActivityAppDelegate: ExpoAppDelegateSubscriber {
    public func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        MainActor.assumeIsolated {
            LiveActivityObserver.shared.start()
        }
        return true
    }
}
