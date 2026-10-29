import Foundation

/// Decides whether the bundled widget extension has to be re-registered with
/// PlugInKit.
///
/// Workaround, not the canonical fix: release builds are ad-hoc signed and not
/// notarized, so macOS does not treat the extension as eligible for automatic
/// discovery. A PlugInKit database rebuild (seen after a macOS update) drops it
/// and the widget gallery stops listing TokenTracker. `pluginkit -a` adds it
/// back, but `man pluginkit` calls that a debugging/development intervention
/// that later clean-ups may undo, so the app re-checks on every launch. Delete
/// this and `WidgetExtensionRegistrar` once builds are Developer ID signed and
/// notarized.
///
/// Foundation-only so TokenTrackerBarTests can cover the decision without the
/// Process/WidgetKit side in `WidgetExtensionRegistrar`.
enum WidgetExtensionRegistrationPolicy {
    static let pluginkitPath = "/usr/bin/pluginkit"
    static let appexName = "TokenTrackerWidget.appex"

    /// Every physical copy of our extension PlugInKit knows about (`-A` all
    /// versions, `-D` duplicates), one per line with its path (`-v`).
    static var matchArguments: [String] {
        ["-m", "-A", "-D", "-v", "-i", WidgetSharedConstants.widgetBundleIdentifier]
    }

    static func addArguments(appexPath: String) -> [String] {
        ["-a", appexPath]
    }

    /// A Gatekeeper-translocated launch runs from a randomized read-only
    /// mount that disappears later; registering it would only leave a dead entry.
    static func isStableInstallPath(_ appexPath: String) -> Bool {
        !appexPath.contains("/AppTranslocation/")
    }

    /// True when the `pluginkit -m -v` output has no entry at `appexPath`.
    /// An existing entry is left alone whatever its user election, so a user
    /// who disabled the extension is never overridden.
    static func needsRegistration(matchOutput: String, appexPath: String) -> Bool {
        let target = normalized(appexPath)
        let registered = matchOutput
            .split(whereSeparator: \.isNewline)
            .contains { line in
                // Verbose lines are tab-separated and end with the bundle path.
                guard let path = line.split(separator: "\t").last else { return false }
                return normalized(String(path)) == target
            }
        return !registered
    }

    private static func normalized(_ path: String) -> String {
        URL(fileURLWithPath: path.trimmingCharacters(in: .whitespaces))
            .standardizedFileURL
            .path
    }
}
