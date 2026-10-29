import SwiftUI
import WidgetKit

// Rate-limit progress widget. The bars ARE the widget. Providers are ordered
// by their hottest window, while windows within a provider keep snapshot order
// so paired quotas (5h, weekly, Spark 5h, Spark 7d) stay predictable. The
// medium size shows one row per provider so no provider crowds out the rest.

struct UsageLimitsWidget: Widget {
    let kind: String = "TokenTrackerLimitsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: StaticSnapshotProvider()) { entry in
            UsageLimitsWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName(WidgetStrings.limitsName)
        .description(WidgetStrings.limitsDescription)
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct UsageLimitsWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: StaticEntry

    private var maxRows: Int {
        family == .systemMedium ? 4 : 8
    }

    /// Medium: each provider's most-used window, hottest provider first.
    /// Large: every window, grouped by provider (see `WidgetLimitLayout`).
    private var orderedRows: [LimitProvider] {
        let rows = WidgetLimitLayout.rows(
            entry.snapshot.limits,
            onePerProvider: family == .systemMedium
        )
        return Array(rows.prefix(maxRows))
    }

    var body: some View {
        let trimmed = orderedRows
        if trimmed.isEmpty {
            WidgetEmptyState(message: WidgetStrings.noConfiguredProviders)
        } else {
            // Uniform spacing across all rows. The grouping (Claude windows
            // adjacent to each other) is communicated by the dot color and
            // shared "Claude · …" label — no extra gap needed. Vertical
            // centering via top/bottom Spacers; the inner VStack uses
            // fixedSize so it doesn't get stretched by the surrounding
            // GeometryReader inside LimitRow.
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                VStack(alignment: .leading, spacing: rowGap) {
                    ForEach(trimmed) { (limit: LimitProvider) in
                        LimitRow(limit: limit, remaining: entry.snapshot.showsRemainingLimits)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var rowGap: CGFloat { family == .systemMedium ? 9 : 12 }
}

private struct LimitRow: View {
    let limit: LimitProvider
    let remaining: Bool

    var body: some View {
        // The number and bar follow the app's Used/Remaining setting; color
        // and urgency track actual usage so they read the same in both modes.
        let used = limit.usedFraction
        let f = limit.displayFraction(remaining: remaining)
        let reset = WidgetFormat.relativeReset(limit.resetsAt)
        let urgent = used >= 0.9
        let textColor: Color = urgent ? WidgetTheme.limitBarColor(used) : .primary

        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Circle()
                    .fill(WidgetTheme.sourceColor(limit.source))
                    .frame(width: 6, height: 6)
                Text(WidgetStrings.limitLabel(limit))
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(textColor)
                    .lineLimit(1)
                Spacer(minLength: 6)
                if let reset {
                    Text(reset)
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                        .monospacedDigit()
                }
                Text(WidgetFormat.percent(f * 100, decimals: 0))
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(textColor)
                    .monospacedDigit()
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(WidgetTheme.limitTrack)
                    RoundedRectangle(cornerRadius: 3)
                        .fill(WidgetTheme.limitBarColor(used))
                        .frame(width: max(geo.size.width * f, f > 0 ? 4 : 0))
                }
            }
            .frame(height: 5)
        }
    }
}
