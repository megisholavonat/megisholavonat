// Design tokens of the MHaV design system (packages/core/src/tokens) as the
// widgets need them, and the small views the Live Activity and the commute
// widget share (design board 4 · Riasztások).

import SwiftUI

enum DelayLevel {
    case onTime, slight, moderate, severe

    /// Thresholds of packages/core/src/constants.ts: up to +5 is on time
    /// (ON_TIME_MAX_MIN), yellow from 6
    init(minutes: Int) {
        if minutes >= 60 {
            self = .severe
        } else if minutes >= 15 {
            self = .moderate
        } else if minutes > 5 {
            self = .slight
        } else {
            self = .onTime
        }
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }

    static let ink = Color(hex: 0x14161A)
    static let ink2Light = Color(hex: 0x5E646E)
    static let staleDark = Color(hex: 0x7A808A)
}

/// DELAY_SCALE: the pill's fill, the minute label on it, and an outline for
/// the light fills that are too pale on their own.
struct DelayColors {
    var fill: Color
    var label: Color
    var outline: Color?
    /// Delay as text on the surface
    var text: Color

    static func of(_ level: DelayLevel, dark: Bool) -> DelayColors {
        switch (level, dark) {
        case (.onTime, false):
            return .init(fill: Color(hex: 0x1A6CCF), label: .white, outline: nil, text: Color(hex: 0x0B5FB8))
        case (.slight, false):
            return .init(fill: Color(hex: 0xF2C230), label: .ink, outline: .ink, text: Color(hex: 0x8A5A00))
        case (.moderate, false):
            return .init(fill: Color(hex: 0xE5660B), label: .ink, outline: .ink, text: Color(hex: 0xB23F00))
        case (.severe, false):
            return .init(fill: Color(hex: 0xC41E16), label: .white, outline: nil, text: Color(hex: 0xB3261E))
        case (.onTime, true):
            return .init(fill: Color(hex: 0x5BA8FF), label: .ink, outline: nil, text: Color(hex: 0x7CB8FF))
        case (.slight, true):
            return .init(fill: Color(hex: 0xFFC93D), label: .ink, outline: nil, text: Color(hex: 0xF7D35C))
        case (.moderate, true):
            return .init(fill: Color(hex: 0xFF8A1F), label: .ink, outline: nil, text: Color(hex: 0xFF9E5E))
        case (.severe, true):
            return .init(fill: Color(hex: 0xF2453D), label: .ink, outline: nil, text: Color(hex: 0xFF7B72))
        }
    }
}

enum Copy {
    static var hungarian: Bool {
        Locale.preferredLanguages.first?.hasPrefix("hu") ?? true
    }

    static var onTime: String { hungarian ? "pontos" : "on time" }
    static var tomorrow: String { hungarian ? "holnap" : "tomorrow" }
    static var follow: String { hungarian ? "Kövess egy vonatot" : "Follow a train" }
    static var delayLabel: String { hungarian ? "Késés" : "Delay" }
    static var platformLabel: String { hungarian ? "Vágány" : "Platform" }

    static func platform(_ p: String) -> String {
        hungarian ? "\(p). vágány" : "Platform \(p)"
    }

    static func minutesLate(_ m: Int) -> String {
        hungarian ? "\(m) perc késés" : "\(m) min late"
    }
}

/// "+23" on its delay colour; "pontos" in blue; grey when stale or unknown.
struct DelayPill: View {
    var minutes: Int?
    var dark: Bool
    var stale: Bool = false
    var size: CGFloat = 15

    var body: some View {
        let colors = DelayColors.of(DelayLevel(minutes: minutes ?? 0), dark: dark)
        let known = minutes != nil && !stale
        Text(text)
            .font(.system(size: size, weight: .heavy))
            .monospacedDigit()
            .lineLimit(1)
            .foregroundStyle(known ? colors.label : (dark ? Color.white : Color.ink))
            .padding(.horizontal, 9)
            .padding(.vertical, 2)
            .background(
                Capsule().fill(known ? colors.fill : Color.staleDark.opacity(0.35))
            )
            .overlay(
                Capsule().strokeBorder(
                    known ? (colors.outline ?? .clear) : Color.staleDark,
                    style: StrokeStyle(lineWidth: 1, dash: known ? [] : [3, 2])
                )
            )
            .accessibilityLabel(accessibility)
    }

    private var text: String {
        guard let minutes else { return "?" }
        return minutes > 0 ? "+\(minutes)" : Copy.onTime
    }

    private var accessibility: String {
        guard let minutes else { return Copy.delayLabel + " ?" }
        return minutes > 0 ? Copy.minutesLate(minutes) : Copy.onTime
    }
}

/// The line as a text badge. The MÁV route glyphs (MNR2007) are not licensed
/// for bundling, so the extension never draws them.
struct LineBadge: View {
    var text: String
    var dark: Bool
    var size: CGFloat = 13

    var body: some View {
        Text(text)
            .font(.system(size: size, weight: .bold))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .foregroundStyle(dark ? Color.ink : Color.white)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(
                RoundedRectangle(cornerRadius: 4).fill(dark ? Color.white : Color.ink)
            )
    }
}

/// The platform in a box: solid when announced, dashed with "?" when it is
/// only the usual one.
struct PlatformBox: View {
    var platform: String
    var sure: Bool
    var color: Color
    var size: CGFloat = 32

    var body: some View {
        Text(sure ? platform : "\(platform)?")
            .font(.system(size: size, weight: .bold))
            .monospacedDigit()
            .lineLimit(1)
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .overlay(
                RoundedRectangle(cornerRadius: 8).strokeBorder(
                    color.opacity(sure ? 0.8 : 0.7),
                    style: StrokeStyle(lineWidth: 2, dash: sure ? [] : [5, 3])
                )
            )
            .accessibilityLabel(Copy.platformLabel + " " + platform + (sure ? "" : "?"))
    }
}

/// Track, filled share and a dot in the delay colour.
struct RideProgress: View {
    var progress: Double
    var dot: Color

    var body: some View {
        GeometryReader { geo in
            let share = min(max(progress, 0), 1)
            let x = geo.size.width * share
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.22)).frame(height: 6)
                Capsule().fill(Color.white).frame(width: max(x, 6), height: 6)
                Circle()
                    .fill(dot)
                    .frame(width: 14, height: 14)
                    .overlay(Circle().strokeBorder(Color.white, lineWidth: 2))
                    .offset(x: min(max(x - 7, 0), geo.size.width - 14))
            }
            .frame(height: geo.size.height)
        }
        .frame(height: 14)
        .accessibilityElement()
        .accessibilityValue("\(Int((min(max(progress, 0), 1) * 100).rounded())) %")
    }
}

/// "17:28" from Unix seconds, in Budapest time like the rest of the app.
enum Clock {
    static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        f.timeZone = TimeZone(identifier: "Europe/Budapest")
        return f
    }()

    static func hhmm(_ seconds: Int?) -> String {
        guard let seconds else { return "–" }
        return formatter.string(from: Date(timeIntervalSince1970: TimeInterval(seconds)))
    }
}
