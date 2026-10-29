import XCTest

final class WidgetSnapshotTests: XCTestCase {

    func testYesterdayDeltaIsUnavailableWhenDailyTrendSkipsYesterday() {
        let snapshot = WidgetSnapshot(
            generatedAt: date(year: 2026, month: 8, day: 10),
            today: PeriodTotals(tokens: 200),
            dailyTrend: [
                DailyPoint(
                    day: date(year: 2026, month: 8, day: 7),
                    totalTokens: 100,
                    costUsd: 0
                ),
                DailyPoint(
                    day: date(year: 2026, month: 8, day: 10),
                    totalTokens: 200,
                    costUsd: 0
                ),
            ]
        )

        XCTAssertEqual(snapshot.yesterdayTokens, 0)
        XCTAssertNil(snapshot.todayDeltaPercent)
    }

    func testYesterdayUsesTheSnapshotGenerationDate() {
        let snapshot = WidgetSnapshot(
            generatedAt: date(year: 2024, month: 2, day: 10),
            today: PeriodTotals(tokens: 150),
            dailyTrend: [
                DailyPoint(
                    day: date(year: 2024, month: 2, day: 9),
                    totalTokens: 75,
                    costUsd: 0
                ),
                DailyPoint(
                    day: date(year: 2024, month: 2, day: 10),
                    totalTokens: 150,
                    costUsd: 0
                ),
            ]
        )

        XCTAssertEqual(snapshot.yesterdayTokens, 75)
        XCTAssertEqual(snapshot.todayDeltaPercent, 100)
    }

    func testRemainingModeShowsWhatIsLeft() {
        let limit = LimitProvider(source: "grok", label: "Grok Build · Weekly", fraction: 0.05, resetsAt: nil)

        XCTAssertEqual(limit.displayFraction(remaining: true), 0.95, accuracy: 1e-9)
        XCTAssertEqual(limit.displayFraction(remaining: false), 0.05, accuracy: 1e-9)
        // Color/urgency keep tracking usage in both modes.
        XCTAssertEqual(limit.usedFraction, 0.05, accuracy: 1e-9)
    }

    func testDisplayFractionClampsOutOfRangeUsage() {
        let over = LimitProvider(source: "codex", label: "Codex · 5h", fraction: 1.2, resetsAt: nil)
        let under = LimitProvider(source: "codex", label: "Codex · 5h", fraction: -0.1, resetsAt: nil)

        XCTAssertEqual(over.displayFraction(remaining: true), 0)
        XCTAssertEqual(over.displayFraction(remaining: false), 1)
        XCTAssertEqual(under.displayFraction(remaining: true), 1)
        XCTAssertEqual(under.displayFraction(remaining: false), 0)
    }

    func testDisplayModeRoundTrips() throws {
        let snapshot = WidgetSnapshot(generatedAt: date(year: 2026, month: 10, day: 29), limitDisplayMode: .remaining)

        let decoded = try JSONDecoder().decode(WidgetSnapshot.self, from: JSONEncoder().encode(snapshot))

        XCTAssertEqual(decoded.limitDisplayMode, .remaining)
        XCTAssertTrue(decoded.showsRemainingLimits)
    }

    func testSnapshotWithoutDisplayModeDecodesAsUsed() throws {
        // Snapshots written before the field existed have no key at all.
        let snapshot = WidgetSnapshot(generatedAt: date(year: 2026, month: 10, day: 29))
        let data = try JSONEncoder().encode(snapshot)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertNil(json["limitDisplayMode"])

        let decoded = try JSONDecoder().decode(WidgetSnapshot.self, from: data)

        XCTAssertNil(decoded.limitDisplayMode)
        XCTAssertFalse(decoded.showsRemainingLimits)
    }

    private func date(year: Int, month: Int, day: Int) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar.date(from: DateComponents(year: year, month: month, day: day, hour: 12))!
    }
}
