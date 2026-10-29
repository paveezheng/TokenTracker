import XCTest

final class WidgetLimitLayoutTests: XCTestCase {

    // The reported case: Antigravity has four windows and the hottest one, so
    // listing every window let it fill the medium widget alone.
    private let limits = [
        LimitProvider(source: "grok", label: "Grok Build · Weekly", fraction: 0.05, resetsAt: nil),
        LimitProvider(source: "antigravity", label: "Antigravity · Cl 7d", fraction: 1.0, resetsAt: nil),
        LimitProvider(source: "antigravity", label: "Antigravity · Cl 5h", fraction: 0, resetsAt: nil),
        LimitProvider(source: "antigravity", label: "Antigravity · Gm 7d", fraction: 0, resetsAt: nil),
        LimitProvider(source: "antigravity", label: "Antigravity · Gm 5h", fraction: 0, resetsAt: nil),
        LimitProvider(source: "codex", label: "Codex · Credits", fraction: 0.7, resetsAt: nil),
    ]

    func testOnePerProviderKeepsEachProvidersHottestWindow() {
        let rows = WidgetLimitLayout.rows(limits, onePerProvider: true)

        XCTAssertEqual(rows.map(\.label), ["Antigravity · Cl 7d", "Codex · Credits", "Grok Build · Weekly"])
    }

    func testAllWindowsStayGroupedInSnapshotOrder() {
        let rows = WidgetLimitLayout.rows(limits, onePerProvider: false)

        XCTAssertEqual(rows.map(\.label), [
            "Antigravity · Cl 7d", "Antigravity · Cl 5h", "Antigravity · Gm 7d", "Antigravity · Gm 5h",
            "Codex · Credits",
            "Grok Build · Weekly",
        ])
    }

    func testEqualWindowsKeepTheFirstOne() {
        let tied = [
            LimitProvider(source: "codex", label: "Codex · 5h", fraction: 0.4, resetsAt: nil),
            LimitProvider(source: "codex", label: "Codex · weekly", fraction: 0.4, resetsAt: nil),
        ]

        XCTAssertEqual(WidgetLimitLayout.rows(tied, onePerProvider: true).map(\.label), ["Codex · 5h"])
    }

    func testEqualProvidersOrderBySource() {
        let tied = [
            LimitProvider(source: "kiro", label: "Kiro · Month", fraction: 0.3, resetsAt: nil),
            LimitProvider(source: "copilot", label: "Copilot · Premium", fraction: 0.3, resetsAt: nil),
        ]

        XCTAssertEqual(WidgetLimitLayout.rows(tied, onePerProvider: true).map(\.source), ["copilot", "kiro"])
    }
}
