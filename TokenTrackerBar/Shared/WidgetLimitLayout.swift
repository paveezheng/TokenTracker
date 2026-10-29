import Foundation

/// Row order for the limits widget. Kept Foundation-only in Shared so the
/// widget extension and TokenTrackerBarTests compile the same logic.
public enum WidgetLimitLayout {

    /// Providers are ordered by their most-used window (ties by source, so
    /// equal-pressure providers keep a stable order between refreshes);
    /// windows within a provider keep snapshot order so paired quotas (5h,
    /// weekly, …) stay predictable.
    ///
    /// `onePerProvider` keeps only each provider's most-used window, so a
    /// provider with many windows cannot crowd the others out of a small widget.
    public static func rows(_ limits: [LimitProvider], onePerProvider: Bool) -> [LimitProvider] {
        let grouped = Dictionary(grouping: limits, by: \.source)
        let orderedGroups = grouped.values.sorted { lhs, rhs in
            let lf = lhs.map(\.fraction).max() ?? 0
            let rf = rhs.map(\.fraction).max() ?? 0
            if lf != rf { return lf > rf }
            return (lhs.first?.source ?? "") < (rhs.first?.source ?? "")
        }
        if onePerProvider {
            // max(by:) keeps the first of equal windows, i.e. snapshot order.
            return orderedGroups.compactMap { $0.max { $0.fraction < $1.fraction } }
        }
        return orderedGroups.flatMap { $0 }
    }
}
