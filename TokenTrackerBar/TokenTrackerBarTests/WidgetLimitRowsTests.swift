import XCTest

final class WidgetLimitRowsTests: XCTestCase {

    // MARK: - Coverage (the drift this file exists to stop)

    func testEveryLimitsPanelProviderReachesTheWidget() throws {
        var overrides: [String: Any] = [:]
        for id in LimitsSettingsStore.allProviders {
            overrides[id] = configuredPayload(for: id)
        }
        let rows = WidgetLimitRows.rows(from: try decodeResponse(overrides: overrides), hiddenProviders: [])

        let sources = Set(rows.map(\.source))
        for id in LimitsSettingsStore.allProviders {
            XCTAssertTrue(sources.contains(id), "\(id) has no widget row")
        }
    }

    func testCodexCreditOnlyPlanStillShows() throws {
        let response = try decodeResponse(overrides: [
            "codex": [
                "configured": true,
                "credit_window": ["used_percent": 70, "remaining_percent": 30, "reset_at": 1_793_491_201],
            ],
        ])

        let rows = WidgetLimitRows.rows(from: response, hiddenProviders: [])

        XCTAssertEqual(rows.map(\.label), ["Codex · \(Strings.codexCreditsLabel)"])
        XCTAssertEqual(rows.first?.fraction ?? -1, 0.70, accuracy: 1e-9)
        XCTAssertEqual(rows.first?.resetsAt, Date(timeIntervalSince1970: 1_793_491_201))
    }

    func testAntigravityShowsAllFourWindowsInPanelOrder() throws {
        let response = try decodeResponse(overrides: [
            "antigravity": [
                "configured": true,
                "primary_window": ["used_percent": 100, "reset_at": "2026-11-04T13:40:16.000Z"],
                "secondary_window": ["used_percent": 0, "reset_at": "2026-10-29T13:47:35.000Z"],
                "tertiary_window": ["used_percent": 0, "reset_at": "2026-11-05T08:47:35.000Z"],
                "quaternary_window": ["used_percent": 0, "reset_at": "2026-10-29T13:47:35.000Z"],
            ],
        ])

        let rows = WidgetLimitRows.rows(from: response, hiddenProviders: [])

        XCTAssertEqual(rows.map(\.label), [
            "Antigravity · Cl 7d", "Antigravity · Cl 5h", "Antigravity · Gm 7d", "Antigravity · Gm 5h",
        ])
        XCTAssertEqual(rows.map(\.fraction), [1, 0, 0, 0])
        XCTAssertNotNil(rows.first?.resetsAt)
    }

    // MARK: - Same gates as the panel

    func testErroredProviderIsSkippedLikeThePanel() throws {
        let response = try decodeResponse(overrides: [
            "copilot": ["configured": true, "error": "rate limited", "primary_window": ["used_percent": 40]],
            "grok": ["configured": true, "period_type": "weekly", "primary_window": ["used_percent": 5]],
        ])

        let rows = WidgetLimitRows.rows(from: response, hiddenProviders: [])

        XCTAssertEqual(rows.map(\.source), ["grok"])
    }

    func testHiddenProvidersAreFilteredOut() throws {
        let response = try decodeResponse(overrides: [
            "grok": ["configured": true, "period_type": "weekly", "primary_window": ["used_percent": 5]],
            "copilot": ["configured": true, "primary_window": ["used_percent": 40]],
        ])

        let rows = WidgetLimitRows.rows(from: response, hiddenProviders: ["copilot"])

        XCTAssertEqual(rows.map(\.label), ["Grok Build · Weekly"])
    }

    func testNoResponseHasNoRows() {
        XCTAssertTrue(WidgetLimitRows.rows(from: nil, hiddenProviders: []).isEmpty)
    }

    // MARK: - Fixtures

    /// A configured, error-free payload with one window for `id`.
    private func configuredPayload(for id: String) -> [String: Any] {
        if id == "claude" {
            return ["configured": true, "five_hour": ["utilization": 10]]
        }
        return ["configured": true, "primary_window": ["used_percent": 10]]
    }

    /// Same JSON path production data takes; required providers default to unconfigured.
    private func decodeResponse(overrides: [String: Any] = [:]) throws -> UsageLimitsResponse {
        var payload: [String: Any] = [
            "fetched_at": "2026-10-29T00:00:00Z",
            "claude": ["configured": false],
            "codex": ["configured": false],
            "cursor": ["configured": false],
            "gemini": ["configured": false],
            "kiro": ["configured": false],
            "antigravity": ["configured": false],
        ]
        for (key, value) in overrides { payload[key] = value }
        let data = try JSONSerialization.data(withJSONObject: payload)
        return try JSONDecoder().decode(UsageLimitsResponse.self, from: data)
    }
}
