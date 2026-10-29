// "My commute" on the home and lock screen (design board 4 · Riasztások):
// the next followed runs with their delay and platform. The app writes them
// to the App Group (src/live/widgetData.ts) and reloads the timelines when
// they change; the widget itself never goes to the network.

import SwiftUI
import WidgetKit

let appGroup = "group.info.megisholavonat.app"
let commuteKey = "commute"
/// A delay older than this is no longer shown
let delayFreshness: TimeInterval = 15 * 60

struct CommuteRun: Codable, Hashable {
    var followId: String
    var badge: String
    var title: String
    /// Boarding station
    var station: String
    /// Scheduled departure there, Unix seconds
    var departure: Int
    var delayMin: Int?
    var platform: String?
    var platformSure: Bool?
    var url: String

    /// Expected departure when the delay is fresh at `date`, else scheduled
    func expected(fresh: Bool) -> Int {
        departure + (fresh ? max(delayMin ?? 0, 0) * 60 : 0)
    }
}

struct CommuteData: Codable {
    /// When the delays were read, Unix seconds
    var updatedAt: Int
    var runs: [CommuteRun]

    static func load() -> CommuteData? {
        guard
            let json = UserDefaults(suiteName: appGroup)?.string(forKey: commuteKey),
            let data = json.data(using: .utf8)
        else { return nil }
        return try? JSONDecoder().decode(CommuteData.self, from: data)
    }
}

struct CommuteEntry: TimelineEntry {
    let date: Date
    let data: CommuteData?

    var fresh: Bool {
        guard let data else { return false }
        return date.timeIntervalSince1970 - TimeInterval(data.updatedAt) < delayFreshness
    }

    /// Runs not yet departed at the entry's date, soonest first
    var runs: [CommuteRun] {
        let now = Int(date.timeIntervalSince1970)
        return (data?.runs ?? [])
            .filter { $0.expected(fresh: fresh) + 60 > now }
            .sorted { $0.expected(fresh: fresh) < $1.expected(fresh: fresh) }
    }
}

struct CommuteProvider: TimelineProvider {
    func placeholder(in context: Context) -> CommuteEntry {
        CommuteEntry(date: Date(), data: CommuteData(updatedAt: Int(Date().timeIntervalSince1970), runs: [
            CommuteRun(
                followId: "", badge: "S70", title: "5123 → Székesfehérvár", station: "Kelenföld",
                departure: Int(Date().timeIntervalSince1970) + 1800, delayMin: 6, platform: "2",
                platformSure: true, url: "megisholavonat://"
            ),
        ]))
    }

    func getSnapshot(in context: Context, completion: @escaping (CommuteEntry) -> Void) {
        let data = CommuteData.load()
        completion(data == nil && context.isPreview ? placeholder(in: context) : CommuteEntry(date: Date(), data: data))
    }

    /// An entry now, when the delay goes stale, and a minute after each
    /// departure, so a run drops off once it has left.
    func getTimeline(in context: Context, completion: @escaping (Timeline<CommuteEntry>) -> Void) {
        let now = Date()
        let data = CommuteData.load()
        var dates = [now]
        if let data {
            dates.append(Date(timeIntervalSince1970: TimeInterval(data.updatedAt) + delayFreshness))
            for run in data.runs {
                for fresh in [true, false] {
                    dates.append(Date(timeIntervalSince1970: TimeInterval(run.expected(fresh: fresh) + 60)))
                }
            }
        }
        let entries = Set(dates.filter { $0 >= now }.map { $0.timeIntervalSince1970.rounded() })
            .sorted()
            .prefix(30)
            .map { CommuteEntry(date: Date(timeIntervalSince1970: $0), data: data) }
        completion(Timeline(entries: Array(entries), policy: .atEnd))
    }
}

private func isTomorrowOrLater(_ seconds: Int, from date: Date) -> Bool {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Europe/Budapest") ?? .current
    return !calendar.isDate(Date(timeIntervalSince1970: TimeInterval(seconds)), inSameDayAs: date)
}

struct CommuteWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme
    var entry: CommuteEntry

    private var dark: Bool { scheme == .dark }
    private var secondary: Color { dark ? Color(hex: 0xA2A8B2) : .ink2Light }

    var body: some View {
        let runs = entry.runs
        Group {
            if let first = runs.first {
                switch family {
                case .systemMedium: medium(Array(runs.prefix(2)))
                case .accessoryRectangular: rectangular(first)
                case .accessoryCircular: circular(first)
                default: small(first)
                }
            } else {
                empty
            }
        }
        .widgetURL(URL(string: runs.first?.url ?? "megisholavonat://"))
    }

    private func delay(_ run: CommuteRun) -> Int? {
        entry.fresh ? run.delayMin : nil
    }

    private func day(_ run: CommuteRun) -> String? {
        isTomorrowOrLater(run.departure, from: entry.date) ? Copy.tomorrow : nil
    }

    private func small(_ run: CommuteRun) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                LineBadge(text: run.badge, dark: dark)
                Spacer(minLength: 4)
                if let minutes = delay(run) {
                    DelayPill(minutes: minutes, dark: dark, size: 13)
                }
            }
            Spacer(minLength: 4)
            Text(day(run).map { "\(run.station) · \($0)" } ?? run.station)
                .font(.system(size: 13))
                .lineLimit(1)
                .foregroundStyle(secondary)
            Text(Clock.hhmm(run.expected(fresh: entry.fresh)))
                .font(.system(size: 30, weight: .bold))
                .monospacedDigit()
                .lineLimit(1)
            if let platform = run.platform, !platform.isEmpty {
                Text(Copy.platform(platform) + (run.platformSure == false ? "?" : ""))
                    .font(.system(size: 14, weight: .semibold))
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private func medium(_ runs: [CommuteRun]) -> some View {
        VStack(spacing: 10) {
            ForEach(runs, id: \.self) { run in
                Link(destination: URL(string: run.url) ?? URL(string: "megisholavonat://")!) {
                    HStack(spacing: 10) {
                        LineBadge(text: run.badge, dark: dark)
                        HStack(spacing: 4) {
                            Text(run.station).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                            if let day = day(run) {
                                Text(day).font(.system(size: 12, weight: .medium)).foregroundStyle(secondary)
                            }
                        }
                        Spacer(minLength: 4)
                        if let platform = run.platform, !platform.isEmpty {
                            Text(run.platformSure == false ? "\(platform)?" : platform)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(secondary)
                                .accessibilityLabel(Copy.platform(platform))
                        }
                        Text(Clock.hhmm(run.expected(fresh: entry.fresh)))
                            .font(.system(size: 16, weight: .bold))
                            .monospacedDigit()
                        if let minutes = delay(run) {
                            DelayPill(minutes: minutes, dark: dark, size: 12)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Lock screen: "Újpest 17:30 · 2 · +6"
    private func rectangular(_ run: CommuteRun) -> some View {
        var parts = [run.station, Clock.hhmm(run.expected(fresh: entry.fresh))]
        if let platform = run.platform, !platform.isEmpty { parts.append(platform) }
        if let minutes = delay(run), minutes > 0 { parts.append("+\(minutes)") }
        return HStack(spacing: 6) {
            Text(run.badge).font(.system(size: 13, weight: .bold))
            Text(parts.joined(separator: " · "))
                .font(.system(size: 15, weight: .semibold))
                .monospacedDigit()
                .lineLimit(2)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func circular(_ run: CommuteRun) -> some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 1) {
                Text(run.badge).font(.system(size: 11, weight: .bold)).lineLimit(1).minimumScaleFactor(0.6)
                Text(delay(run).map { $0 > 0 ? "+\($0)" : Clock.hhmm(run.expected(fresh: entry.fresh)) }
                    ?? Clock.hhmm(run.departure))
                    .font(.system(size: 13, weight: .heavy))
                    .monospacedDigit()
                    .minimumScaleFactor(0.6)
            }
        }
    }

    private var empty: some View {
        Text(Copy.follow)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct CommuteWidget: Widget {
    static let kind = "CommuteWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: CommuteProvider()) { entry in
            CommuteWidgetView(entry: entry)
                .containerBackground(for: .widget) { Color(.systemBackground) }
        }
        .configurationDisplayName("MHaV")
        .description(Copy.hungarian ? "A következő követett vonatod" : "Your next followed train")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular])
    }
}
