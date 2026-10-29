import Foundation

/// Flattens the native limits payload into the desktop widget's uniform rows.
///
/// Mirrors the menu bar Limits panel (`UsageLimitsView`'s per-provider specs):
/// the same providers and windows in the same order, only for providers that
/// are configured without an error, minus the ones the user hid. When the
/// panel gains a provider or a window, add it here too;
/// `WidgetLimitRowsTests` pins the coverage.
///
/// Labels read "<Provider> · <window>". The widget localizes a few generic
/// window kinds (5h / 7d / weekly) itself and shows the rest as written.
enum WidgetLimitRows {

    static func rows(from limits: UsageLimitsResponse?, hiddenProviders: Set<String>) -> [LimitProvider] {
        guard let limits else { return [] }
        var out: [LimitProvider] = []

        func usable(_ configured: Bool, _ error: String?) -> Bool {
            configured && error == nil
        }
        func addRow(_ source: String, _ label: String, _ usedPercent: Double, _ resetsAt: Date?) {
            out.append(LimitProvider(source: source, label: label, fraction: usedPercent / 100.0, resetsAt: resetsAt))
        }
        func addWindow(_ source: String, _ label: String, _ window: GenericLimitWindow?) {
            guard let window else { return }
            addRow(source, label, window.usedPercent, parseISO(window.resetAt))
        }
        func addCodexWindow(_ label: String, _ window: CodexWindow?) {
            guard let window else { return }
            addRow("codex", label, Double(window.usedPercent), parseEpoch(window.resetAt))
        }

        // Claude — `utilization` is a 0–100 percentage like every other window.
        let claude = limits.claude
        if usable(claude.configured, claude.error) {
            if let w = claude.fiveHour { addRow("claude", "Claude · 5h", w.utilization, parseISO(w.resetsAt)) }
            if let w = claude.sevenDay { addRow("claude", "Claude · 7d", w.utilization, parseISO(w.resetsAt)) }
            if let w = claude.sevenDayOpus { addRow("claude", "Claude · 7d Opus", w.utilization, parseISO(w.resetsAt)) }
            for w in claude.weeklyScoped ?? [] {
                addRow("claude", "Claude · 7d \(w.label)", w.utilization, parseISO(w.resetsAt))
            }
        }

        let codex = limits.codex
        if usable(codex.configured, codex.error) {
            addCodexWindow("Codex · 5h", codex.primaryWindow)
            addCodexWindow("Codex · weekly", codex.secondaryWindow)
            if let w = codex.creditWindow {
                addRow("codex", "Codex · \(Strings.codexCreditsLabel)", w.usedPercent, parseEpoch(w.resetAt))
            }
            addCodexWindow("Codex · Spark 5h", codex.sparkPrimaryWindow)
            addCodexWindow("Codex · Spark 7d", codex.sparkSecondaryWindow)
        }

        let cursor = limits.cursor
        if usable(cursor.configured, cursor.error) {
            addWindow("cursor", "Cursor · \(Strings.cursorPlanLabel)", cursor.primaryWindow)
            addWindow("cursor", "Cursor · \(Strings.cursorAutoLabel)", cursor.secondaryWindow)
            addWindow("cursor", "Cursor · API", cursor.tertiaryWindow)
            addWindow("cursor", "Cursor · \(Strings.cursorGrokBotLabel)", cursor.quaternaryWindow)
        }

        let gemini = limits.gemini
        if usable(gemini.configured, gemini.error) {
            addWindow("gemini", "Gemini · Pro", gemini.primaryWindow)
            addWindow("gemini", "Gemini · Flash", gemini.secondaryWindow)
            addWindow("gemini", "Gemini · Lite", gemini.tertiaryWindow)
        }

        if let kimi = limits.kimi, usable(kimi.configured, kimi.error) {
            addWindow("kimi", "Kimi · weekly", kimi.primaryWindow)
            addWindow("kimi", "Kimi · 5h", kimi.secondaryWindow)
            addWindow("kimi", "Kimi · total", kimi.tertiaryWindow)
        }

        let kiro = limits.kiro
        if usable(kiro.configured, kiro.error) {
            addWindow("kiro", "Kiro · \(Strings.kiroMonthLabel)", kiro.primaryWindow)
            addWindow("kiro", "Kiro · \(Strings.kiroBonusLabel)", kiro.secondaryWindow)
        }

        if let grok = limits.grok, usable(grok.configured, grok.error) {
            let periodLabel: String
            switch grok.periodType {
            case "weekly": periodLabel = "Weekly"
            case "daily": periodLabel = "Daily"
            default: periodLabel = "Month"
            }
            addWindow("grok", "Grok Build · \(periodLabel)", grok.primaryWindow)
            addWindow("grok", "Grok Build · On-demand", grok.secondaryWindow)
        }

        let antigravity = limits.antigravity
        if usable(antigravity.configured, antigravity.error) {
            addWindow("antigravity", "Antigravity · Cl 7d", antigravity.primaryWindow)
            addWindow("antigravity", "Antigravity · Cl 5h", antigravity.secondaryWindow)
            addWindow("antigravity", "Antigravity · Gm 7d", antigravity.tertiaryWindow)
            addWindow("antigravity", "Antigravity · Gm 5h", antigravity.quaternaryWindow)
        }

        if let copilot = limits.copilot, usable(copilot.configured, copilot.error) {
            addWindow("copilot", "Copilot · Premium", copilot.primaryWindow)
            addWindow("copilot", "Copilot · Chat", copilot.secondaryWindow)
        }

        if let zcode = limits.zcode, usable(zcode.configured, zcode.error) {
            if zcode.planKind == "coding-plan" {
                addWindow("zcode", "ZCode · 5h", zcode.primaryWindow)
                addWindow("zcode", "ZCode · Weekly", zcode.secondaryWindow)
                addWindow("zcode", "ZCode · Tools", zcode.tertiaryWindow)
            } else if let buckets = zcode.labeledBuckets {
                for bucket in buckets { addWindow("zcode", "ZCode · \(bucket.label)", bucket.window) }
            } else {
                addWindow("zcode", "ZCode · GLM-5.2", zcode.primaryWindow)
                addWindow("zcode", "ZCode · GLM-5-Turbo", zcode.secondaryWindow)
            }
        }

        if let opencodeGo = limits.opencodeGo, usable(opencodeGo.configured, opencodeGo.error) {
            addWindow("opencodeGo", "OpenCode Go · 5h", opencodeGo.primaryWindow)
            addWindow("opencodeGo", "OpenCode Go · Weekly", opencodeGo.secondaryWindow)
            addWindow("opencodeGo", "OpenCode Go · Monthly", opencodeGo.tertiaryWindow)
        }

        if let commandCode = limits.commandCode, usable(commandCode.configured, commandCode.error) {
            addWindow("commandCode", "Command Code · 5h", commandCode.primaryWindow)
            addWindow("commandCode", "Command Code · Weekly", commandCode.secondaryWindow)
        }

        if let qoder = limits.qoder, usable(qoder.configured, qoder.error) {
            addWindow("qoder", "Qoder · \(Strings.qoderPlanLabel)", qoder.primaryWindow)
            addWindow("qoder", "Qoder · \(Strings.qoderBonusLabel)", qoder.secondaryWindow)
        }

        if let qoderCn = limits.qoderCn, usable(qoderCn.configured, qoderCn.error) {
            addWindow("qoderCn", "Qoder CN · \(Strings.qoderPlanLabel)", qoderCn.primaryWindow)
            addWindow("qoderCn", "Qoder CN · \(Strings.qoderBonusLabel)", qoderCn.secondaryWindow)
        }

        if let codingPlan = limits.codingPlan, usable(codingPlan.configured, codingPlan.error) {
            addWindow("codingPlan", "Ark Coding Plan · 5h", codingPlan.primaryWindow)
            addWindow("codingPlan", "Ark Coding Plan · Weekly", codingPlan.secondaryWindow)
            addWindow("codingPlan", "Ark Coding Plan · Monthly", codingPlan.tertiaryWindow)
        }

        if let agentPlan = limits.agentPlan, usable(agentPlan.configured, agentPlan.error) {
            addWindow("agentPlan", "Ark Agent Plan · 5h", agentPlan.primaryWindow)
            addWindow("agentPlan", "Ark Agent Plan · Weekly", agentPlan.secondaryWindow)
            addWindow("agentPlan", "Ark Agent Plan · Monthly", agentPlan.tertiaryWindow)
        }

        if let devin = limits.devin, usable(devin.configured, devin.error) {
            addWindow("devin", "Devin · Daily", devin.primaryWindow)
            addWindow("devin", "Devin · Weekly", devin.secondaryWindow)
        }

        if let workbuddy = limits.workbuddy, usable(workbuddy.configured, workbuddy.error) {
            addWindow("workbuddy", "WorkBuddy · \(Strings.workbuddyPlanLabel)", workbuddy.primaryWindow)
        }

        // Honor the user's Limits Display visibility preferences — the
        // dashboard, popover and menu bar all hide these providers, so the
        // desktop widget must not keep showing them (PR #168 follow-up).
        return out.filter { !hiddenProviders.contains($0.source) }
    }

    private static let iso8601: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static func parseISO(_ s: String?) -> Date? {
        guard let s else { return nil }
        if let d = iso8601.date(from: s) { return d }
        // Retry without fractional seconds
        let alt = ISO8601DateFormatter()
        alt.formatOptions = [.withInternetDateTime]
        return alt.date(from: s)
    }

    private static func parseEpoch(_ epoch: Int?) -> Date? {
        guard let epoch else { return nil }
        return Date(timeIntervalSince1970: TimeInterval(epoch))
    }
}
