import Foundation
import WidgetKit
import os

/// Puts the bundled widget extension back into PlugInKit when it has gone
/// missing, so the widget gallery keeps listing TokenTracker. See
/// `WidgetExtensionRegistrationPolicy` for why ad-hoc builds need this.
///
/// `pluginkit` runs off the main thread; every failure is logged and otherwise
/// ignored so this can never affect launch.
enum WidgetExtensionRegistrar {

    private static let logger = Logger(subsystem: "com.tokentracker.bar", category: "WidgetExtensionRegistrar")

    /// Serial so a launch check and an "Add widgets" click never race.
    private static let queue = DispatchQueue(label: "com.tokentracker.widget-registration", qos: .utility)

    /// Checks the registration and repairs it if needed. `completion` runs on
    /// the main queue afterwards, whatever the outcome.
    static func ensureRegistered(completion: (() -> Void)? = nil) {
        let appexPath = NativeQAProfile.isQABuild ? nil : Bundle.main.builtInPlugInsURL?
            .appendingPathComponent(WidgetExtensionRegistrationPolicy.appexName)
            .path
        queue.async {
            if let appexPath {
                registerIfMissing(appexPath: appexPath)
            }
            if let completion {
                DispatchQueue.main.async(execute: completion)
            }
        }
    }

    private static func registerIfMissing(appexPath: String) {
        guard FileManager.default.fileExists(atPath: appexPath),
              WidgetExtensionRegistrationPolicy.isStableInstallPath(appexPath),
              let match = runPluginkit(WidgetExtensionRegistrationPolicy.matchArguments),
              WidgetExtensionRegistrationPolicy.needsRegistration(matchOutput: match.output, appexPath: appexPath)
        else { return }

        guard let add = runPluginkit(WidgetExtensionRegistrationPolicy.addArguments(appexPath: appexPath)),
              add.status == 0 else {
            logger.warning("pluginkit could not register the widget extension")
            return
        }
        logger.info("Re-registered the widget extension at \(appexPath, privacy: .public)")
        DispatchQueue.main.async {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    private static func runPluginkit(_ arguments: [String]) -> (status: Int32, output: String)? {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: WidgetExtensionRegistrationPolicy.pluginkitPath)
        process.arguments = arguments
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            logger.warning("pluginkit failed to launch: \(error.localizedDescription, privacy: .public)")
            return nil
        }
        // Drain before waiting so a full pipe can never block the child.
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return (process.terminationStatus, String(decoding: data, as: UTF8.self))
    }
}
