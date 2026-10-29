// The followed train on the lock screen and in the Dynamic Island (design
// board 4 · Riasztások): the line and destination with the delay, the stop
// that matters next with its expected time and platform, and the ride's
// progress. Always drawn light-on-dark, so the dark delay scale is used.

import ActivityKit
import SwiftUI
import WidgetKit

private typealias State = TrainActivityAttributes.ContentState

private extension State {
    var level: DelayLevel { DelayLevel(minutes: delayMin ?? 0) }
    var colors: DelayColors { DelayColors.of(level, dark: true) }
}

struct TrainLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TrainActivityAttributes.self) { context in
            LockScreenView(attributes: context.attributes, state: context.state, stale: context.isStale)
                .activityBackgroundTint(Color(hex: 0x1C1F26).opacity(0.82))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(URL(string: context.attributes.url))
        } dynamicIsland: { context in
            let state = context.state
            let stale = context.isStale
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    LineBadge(text: context.attributes.badge, dark: true, size: 15)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    DelayPill(minutes: state.delayMin, dark: true, stale: stale, size: 14)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 8) {
                        NextStopRow(state: state, timeSize: 28)
                        if state.departed == true {
                            RideProgress(progress: state.progress ?? 0, dot: state.colors.fill)
                        }
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                LineBadge(text: context.attributes.badge, dark: true, size: 12)
            } compactTrailing: {
                CompactTrailing(state: state, stale: stale)
            } minimal: {
                CompactTrailing(state: state, stale: stale)
            }
            .widgetURL(URL(string: context.attributes.url))
            .keylineTint(state.colors.fill)
        }
    }
}

/// "+23" in its colour when late; on time, the expected time in blue.
private struct CompactTrailing: View {
    var state: State
    var stale: Bool

    var body: some View {
        let late = (state.delayMin ?? 0) > 0
        Text(late ? "+\(state.delayMin ?? 0)" : Clock.hhmm(state.nextStopAt))
            .font(.system(size: 14, weight: .heavy))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .foregroundStyle(stale || state.delayMin == nil ? Color.white : state.colors.fill)
    }
}

/// Stop name above its expected time, the platform box on the right.
private struct NextStopRow: View {
    var state: State
    var timeSize: CGFloat

    var body: some View {
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 0) {
                Text(state.nextStop ?? "")
                    .font(.system(size: 14))
                    .lineLimit(1)
                    .foregroundStyle(.white.opacity(0.75))
                Text(Clock.hhmm(state.nextStopAt))
                    .font(.system(size: timeSize, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(.white)
            }
            Spacer(minLength: 8)
            if let platform = state.platform, !platform.isEmpty {
                PlatformBox(
                    platform: platform,
                    sure: state.platformSure ?? true,
                    color: .white,
                    size: timeSize
                )
            }
        }
    }
}

private struct LockScreenView: View {
    var attributes: TrainActivityAttributes
    var state: State
    var stale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                LineBadge(text: attributes.badge, dark: true, size: 15)
                Text(attributes.title)
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)
                    .foregroundStyle(.white)
                Spacer(minLength: 4)
                DelayPill(minutes: state.delayMin, dark: true, stale: stale)
            }
            NextStopRow(state: state, timeSize: 32)
            RideProgress(progress: state.progress ?? 0, dot: state.colors.fill)
        }
        .padding(16)
    }
}
