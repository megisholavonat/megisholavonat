// The Live Activity of a followed train. This file exists twice, identical:
// in the widget extension (targets/widgets) and in the app's native module
// (modules/live-activity/ios); ActivityKit matches the two by type name and
// shape. A unit test (src/live/attributes.test.ts) keeps them the same.
//
// ContentState is also what the API pushes (apps/api, push_alerts.py
// `live_activity_content`). Every field is optional so that a push with a
// missing or new key still decodes; an update that fails to decode is
// dropped by iOS.

import ActivityKit
import Foundation

struct TrainActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// Delay in whole minutes, never negative; nil when unknown
        var delayMin: Int?
        /// The boarding station until the train leaves it, then the next stop
        var nextStop: String?
        /// Expected time at `nextStop`, Unix seconds
        var nextStopAt: Int?
        /// Platform at `nextStop`
        var platform: String?
        /// False when the platform is only the usual one (shown as "4?")
        var platformSure: Bool?
        /// Expected arrival at the alighting station, Unix seconds
        var eta: Int?
        /// Share of the ride from boarding to alighting behind the train, 0...1
        var progress: Double?
        /// Left the boarding station
        var departed: Bool?
    }

    /// The follow on the API this activity shows
    var followId: String
    /// Text badge for the line ("S70", "IC"): the MÁV route glyph font
    /// cannot be bundled into the extension
    var badge: String
    /// "10 → Záhony"
    var title: String
    /// Boarding and alighting station names
    var from: String
    var to: String
    /// Opened on tap, e.g. megisholavonat://followed/<follow id>
    var url: String
}
