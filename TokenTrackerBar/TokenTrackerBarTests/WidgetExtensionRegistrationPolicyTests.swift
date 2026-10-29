import XCTest

final class WidgetExtensionRegistrationPolicyTests: XCTestCase {
    private let appex = "/Applications/TokenTracker.app/Contents/PlugIns/TokenTrackerWidget.appex"

    func testRegisteredPathNeedsNothing() {
        let output = "     com.tokentracker.bar.widget(1.5.0)\tB18330B4-56C5-4A58-A143-CAEB72721186\t2026-10-29 09:02:21 +0000\t\(appex)\n (1 plug-in)\n"

        XCTAssertFalse(WidgetExtensionRegistrationPolicy.needsRegistration(matchOutput: output, appexPath: appex))
    }

    func testNoMatchesNeedsRegistration() {
        XCTAssertTrue(WidgetExtensionRegistrationPolicy.needsRegistration(matchOutput: "  (no matches)\n", appexPath: appex))
    }

    func testEmptyOutputNeedsRegistration() {
        XCTAssertTrue(WidgetExtensionRegistrationPolicy.needsRegistration(matchOutput: "", appexPath: appex))
    }

    func testOnlyAnotherCopyRegisteredNeedsRegistration() {
        let devBuild = "/Users/dev/Library/Developer/Xcode/DerivedData/TokenTrackerBar-x/Build/Products/Release/TokenTrackerWidget.appex"
        let output = "     com.tokentracker.bar.widget(1.4.7)\tUUID\t2026-10-22 03:20:20 +0000\t\(devBuild)\n"

        XCTAssertTrue(WidgetExtensionRegistrationPolicy.needsRegistration(matchOutput: output, appexPath: appex))
    }

    func testPathThatOnlyEndsWithOursDoesNotCount() {
        let nested = "/Users/dev\(appex)"
        let output = "     com.tokentracker.bar.widget(1.5.0)\tUUID\tdate\t\(nested)\n"

        XCTAssertTrue(WidgetExtensionRegistrationPolicy.needsRegistration(matchOutput: output, appexPath: appex))
    }

    func testUserElectionIsLeftAlone() {
        // "-" = the user elected to ignore the extension; it is still registered.
        let output = "-    com.tokentracker.bar.widget(1.5.0)\tUUID\tdate\t\(appex)\n"

        XCTAssertFalse(WidgetExtensionRegistrationPolicy.needsRegistration(matchOutput: output, appexPath: appex))
    }

    func testTrailingSlashStillMatches() {
        let output = "     com.tokentracker.bar.widget(1.5.0)\tUUID\tdate\t\(appex)/\n"

        XCTAssertFalse(WidgetExtensionRegistrationPolicy.needsRegistration(matchOutput: output, appexPath: appex))
    }

    func testTranslocatedLaunchIsNotStable() {
        let translocated = "/private/var/folders/xy/T/AppTranslocation/1234/d/TokenTracker.app/Contents/PlugIns/TokenTrackerWidget.appex"

        XCTAssertFalse(WidgetExtensionRegistrationPolicy.isStableInstallPath(translocated))
        XCTAssertTrue(WidgetExtensionRegistrationPolicy.isStableInstallPath(appex))
    }

    func testMatchListsEveryCopyWithPaths() {
        let args = WidgetExtensionRegistrationPolicy.matchArguments

        XCTAssertEqual(args.first, "-m")
        XCTAssertTrue(args.contains("-A"))
        XCTAssertTrue(args.contains("-D"))
        XCTAssertTrue(args.contains("-v"))
        XCTAssertEqual(args.suffix(2), ["-i", WidgetSharedConstants.widgetBundleIdentifier])
    }

    func testAddRegistersTheGivenPath() {
        XCTAssertEqual(WidgetExtensionRegistrationPolicy.addArguments(appexPath: appex), ["-a", appex])
    }
}
