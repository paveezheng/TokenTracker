---
repo: TokenTracker
layer: macos
module: menu-bar-popover
severity: S2
design_mismatch: yes
detection_gap: yes
---

# Menu bar popover invisible over full-screen Spaces — 2026-10-22

**Status:** fixed on branch `fix/macos-popover-fullscreen-anchor` and reported fixed on the affected machine. Not released. The regression scenarios listed under [Follow-ups](#follow-ups) have not been confirmed one by one.

## Symptom

Clicking the menu bar icon while another app is in native full screen (Chrome, Warp) shows nothing. On a normal desktop Space the popover opens. Once it fails, it keeps failing for the life of the process; relaunching makes it work again until the next time it breaks. Related history: #297 and #681 (closed after a fix verified only on macOS 15), plus the earlier Space fixes #372, #481 and #506.

## Environment

- macOS 26.7.1 (25G241), Apple M4.
- Two displays: built-in Retina (notch) and DELL U2419HS; "Displays have separate Spaces" on; the menu bar auto-hides in full screen (system default).
- Local Release build of 1.4.7, ad-hoc signed, running as an `LSUIElement` agent.

## How it was diagnosed

None of these tools were committed:

- A `CGWindowListCopyWindowInfo` tracer logged TokenTracker's window frames, `kCGWindowIsOnscreen` and the frontmost app while the bug was reproduced.
- A probe read TokenTracker's activation policy from `NSRunningApplication`.
- Standalone AppKit programs rebuilt the anchor + popover setup with one variable changed at a time.

| # | Observation | Meaning |
| --- | --- | --- |
| 1 | Over a full-screen app, on either display, the popover was shown at the right position and display, but both the anchor and the popover reported `onscreen=false`. The activate + re-show recovery ran and also landed off screen. On a normal desktop, the same windows (including the alpha-0 anchor) reported `onscreen=true`. | The windows were placed on a Space that was not visible. The measurement is reliable. |
| 2 | During a Space swipe, the anchor's frame slid with the desktop Space. | The anchor was bound to one desktop Space instead of joining all Spaces. |
| 3 | Lock/unlock, sleep/wake, leaving and re-entering full screen, and replugging or rearranging the displays did not reproduce it. | The trigger is app state, not a system event. |
| 4 | Same full-screen Space, fresh windows: `.regular` with a plain `NSWindow` anchor → anchor and popover off screen; `.regular` with an `NSPanel` (`.nonactivatingPanel`) anchor → both on screen; `.accessory` with a plain `NSWindow` anchor → on screen. | Under `.regular`, a plain window is not admitted onto another app's full-screen Space. A non-activating panel is. |
| 5 | Deterministic reproduction in the real app: (1) relaunch normally, which opens the Dashboard and makes the app `.regular`; (2) while the Dashboard is open, click the icon on a desktop and close the popover; (3) close the Dashboard, after which the policy probe reads `accessory`; (4) click over a full-screen app. Nothing appears. | One open under `.regular` breaks the cached anchor for the rest of the process. |

## Root cause

1. Opening the Dashboard switches the app to `.regular` (`DashboardPresentationCoordinator`). A normal (non-login-item) launch opens the Dashboard automatically (`AppDelegate.applicationDidFinishLaunching`).
2. The popover is attached as a child of an app-owned anchor window. #193 introduced this anchor; see below for why it exists. The anchor was a plain borderless `NSWindow`, created once and reused for the whole process.
3. A plain window owned by a `.regular` app is not admitted onto another app's full-screen Space, even with `.canJoinAllSpaces + .fullScreenAuxiliary`. An anchor ordered in while the app was `.regular` also stayed pinned to that desktop Space after the app returned to `.accessory`. The child popover followed it. The activate + re-show recovery reused the same anchor, so it could not recover, and it took keyboard focus away from the full-screen app.
4. This explains why the bug is intermittent and why maintainers could not reproduce it. It only appears after the icon has been clicked while the Dashboard was open. A fresh launch where the Dashboard is closed before the first click behaves correctly.

## Fix

- `makePopoverAnchorWindow()` now returns an `NSPanel` with `[.borderless, .nonactivatingPanel]` and sets `hidesOnDeactivate = false`. `NSPanel` hides on deactivation by default, which would also hide the child popover. Level and collection behavior are unchanged. This matches the app's other panels that must appear over full-screen apps: confetti, desktop pet and Dynamic Island. `.nonactivatingPanel` is the AppKit window type for auxiliary windows that must not activate the owning app.
- Every open builds a new anchor. `positionPopoverAnchorWindow` first calls `discardPopoverAnchorWindow()`, which detaches the reused popover window and closes the old anchor. This step is defensive and is not an Apple requirement: the experiments only proved that a *freshly created* panel is admitted under `.regular`, so no Space assignment may carry over from an earlier open.
- `test/macos-popover-anchor-window.test.js` now requires a non-activating, non-hiding panel anchor that is never reused.

Verification so far: the source test passes (3/3), the Release build succeeds, and the user reported on the affected machine that the reproduction above no longer fails.

## Why not the Apple-standard pattern

The textbook pattern is `popover.show(relativeTo: statusItem.button.bounds, of: statusItem.button, preferredEdge: .minY)`. A standalone status item using exactly this pattern was tested on the same machine, as an `.accessory` app. In 2 of 3 clicks the popover first appeared under the clicked icon and, within about a second, moved to the other display. This is the bug #193 reported when it introduced the anchor. Each status item has a single real window, which the system moves between the displays' menu bars as the full-screen menu bar auto-hides, and `NSPopover` follows its positioning view. A stable app-owned anchor is therefore still needed. Within that design, a non-activating panel is the appropriate window type.

Other Apple-provided options:

- SwiftUI `MenuBarExtra` (`.window` style) is not viable today. It needs macOS 13 while the deployment target is 12, it has no programmatic open, it has no right-click menu, and it cannot host the animated, composited status item label.
- macOS 27 adds `NSStatusItem.expandedInterfaceDelegate`, Apple's API for custom windows shown from a status item. It is the candidate replacement behind `#available(macOS 27, *)` once it can be tested on macOS 27; its documentation currently covers only `statusItem(_:didBegin:)`, `statusItemDidEndExpandedInterfaceSession(_:animated:)` and `NSStatusItemExpandedInterfaceSession.cancel()`.

## Follow-ups

- Before release, confirm the earlier Space scenarios on the fixed build:
  - two displays, with a full-screen app on either one, clicking each display's menu bar (#193, #481);
  - multiple desktops (#372, #506);
  - macOS 15 over a full-screen app (#681), which needs an external tester.
- Shipping requires a version bump in `package.json` and the release workflow (Swift-only change; see CLAUDE.md).
- The activate + re-show fallback in `togglePopover` should now rarely run. Once macOS 15 is verified, decide whether it is still needed, since it takes focus from the full-screen app.
- `UpdateChecker.presentAlert` snapshots the activation policy before its modal and restores it afterwards. If the Dashboard opens or closes during the modal, the restored policy is stale. This was not the cause here, but the policy should be owned by `DashboardPresentationCoordinator`.

## Regression check

1. Quit TokenTracker and launch it normally; the Dashboard opens.
2. With the Dashboard still open, click the menu bar icon on a desktop, then close the popover.
3. Close the Dashboard.
4. Put another app in full screen and click the icon. The popover must appear.
5. With the Dashboard open, click the icon over a full-screen app. The popover must appear.
