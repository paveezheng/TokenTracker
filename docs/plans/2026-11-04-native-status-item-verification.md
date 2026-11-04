# 菜单栏原生展示验收清单

分支 `refactor/native-status-item-expanded-interface`，实现提交 `ef209c46`。对应 issue [#866](https://github.com/xiufengsun/TokenTracker/issues/866)，方案见 `docs/plans/2026-10-25-native-status-item-popover-refactor.md`。

两个人各做一块，不要互相代填：

- **人工**：只填第 2 节。这些步骤必须在正在运行的 macOS app 上点出来。
- **交叉 agent**：只填第 3 节。只读代码、跑下面列出的命令，并引用文件和行号。不要把第 2 节标成通过，也不要启动或点击这台机器上的 TokenTracker。

把结论写在第 4 节。任一项失败就停，不要为了勾完而改判定。

## 1. 先准备的构建

在本分支上编一个 Release，再完全退出正在跑的 TokenTracker，从编出来的 `.app` 启动。不要用旧的已安装副本。

```bash
cd TokenTrackerBar
xcodegen generate && ruby scripts/patch-pbxproj-icon.rb
xcodebuild -scheme TokenTrackerBar -configuration Release -destination 'platform=macOS,arch=arm64' build
```

记录：macOS 版本、机器、显示器数量、「显示器有单独的空间」是否打开、菜单栏在全屏时是否自动隐藏。

## 2. 人工手测

每项记 `pass` / `fail` / `skip`，失败时写你实际看到的现象。macOS 27 上界面是状态项下方的圆角 panel，没有 popover 小箭头，这是预期形状。

### 2.1 原问题，必须过

这是 [#866](https://github.com/xiufengsun/TokenTracker/issues/866) 的复现。以前会在第 4 步之后一直不出现，直到退出进程。

- [ ] 退出 TokenTracker，正常启动。Dashboard 自己打开。
- [ ] Dashboard 还开着时，在普通桌面点一次菜单栏图标，界面出现在点的那块屏上，再关掉。
- [ ] 关掉 Dashboard。
- [ ] 把另一个 App（Chrome 或 Warp）做成原生全屏，点 TokenTracker 图标。界面必须出现在这个全屏 Space 里，而不是闪一下、出现在别的桌面，或什么都没有。
- [ ] 关掉界面。再把 Dashboard 打开，在同一个全屏 App 上再点一次图标。界面仍然出现。
- [ ] 重复上一轮「Dashboard 开着点一次、关掉、再在全屏上点」至少两次。第二次不得失败。

### 2.2 同一套交互还在

- [ ] 左键再点一次图标，界面关闭，菜单栏图标的按下高亮也结束。
- [ ] 点界面里面的内容，界面不关闭。滚动、切换图表周期仍然可用。
- [ ] 点 Dashboard 窗口，菜单栏界面关闭。
- [ ] 点另一个 App 的窗口，菜单栏界面关闭。
- [ ] 右键图标，出现原来的菜单，而不是空白或又一个 dashboard panel。
- [ ] 关掉右键菜单后再左键，界面还能打开。连续右键两次，不会叠出两个菜单。
- [ ] 右键菜单里点今日摘要那一行，菜单关掉后界面打开。
- [ ] 右键菜单里的「检查更新」在检查或下载过程中，标题会变。这一项可以在更新检查进行时看。
- [ ] 从菜单或界面打开 Dashboard 时，菜单栏界面先收起，不会盖住 Dashboard。
- [ ] 触发一次更新提示（或任何会走到 `UpdateChecker.presentAlert` 的提示）。提示不被菜单栏界面挡住，提示关闭后左键仍能打开界面。

### 2.3 外观和菜单栏图标

- [ ] 界面贴在图标下方。图标靠近屏幕左缘或右缘时，界面整块留在屏幕内。
- [ ] 界面打开期间，菜单栏上的用量文字可以更新，但图标宽度不变，界面不跟着横移。关掉之后宽度再跟上。
- [ ] macOS 26 及以上：背景是系统玻璃，内容不是一块不透明白底或完全透明。macOS 27 没有小箭头可以接受。
- [ ] 打开界面时，全屏 App 不失去键盘焦点，Space 不跳走。如果焦点被抢走，记下来，这是失败。

### 2.4 多屏和多个桌面

只有一块屏就标 `skip`，不要当成通过。

- [ ] 两块屏都开着普通桌面。分别点每块屏的菜单栏图标，界面出现在被点的那块屏上，约一秒内不跳到另一块屏。
- [ ] 只把其中一块屏上的 App 全屏，点这一块的图标，界面出现在这块屏的全屏 Space。再点另一块普通桌面的图标，界面出现在那块桌面上。
- [ ] 两块屏各放一个全屏 App，分别点各自的菜单栏。两次都出现在对应的屏上。
- [ ] 同一块屏上左右切两个桌面，两边点图标都能出现，不会只固定在第一次打开时的那个桌面。

### 2.5 这次不在本机范围里的项

- [ ] macOS 15 上、别的 App 全屏时点图标仍能出现（#681）。需要一台 macOS 15，本机没有就标 `skip`。
- [ ] macOS 12–26 上，popover 仍相对状态项按钮出现，并保留小箭头。本机是 macOS 27 就标 `skip`。

## 3. 交给另一个 agent 的交叉核对

把下面这段原样发给 agent。它只能改第 4 节里属于它的记录，不能改产品代码。

```text
只读核对 TokenTracker 分支 refactor/native-status-item-expanded-interface 的菜单栏展示改动。
阅读 docs/plans/2026-11-04-native-status-item-verification.md 第 3 节，
逐项给 pass 或 fail，每项附文件路径和行号，或附命令输出。
不要运行 TokenTracker app，不要把第 2 节的手测标成通过，不要修改产品代码。
失败就停在失败项。把结果写入该文档第 4 节的「Agent」记录。
```

### 3.1 锚点机制已经删除

在 `TokenTrackerBar/TokenTrackerBar/Services/StatusBarController.swift` 里，下面这些符号必须一次都不出现：

- [ ] `popoverAnchorWindow`
- [ ] `makePopoverAnchorWindow`
- [ ] `positionPopoverAnchorWindow`
- [ ] `discardPopoverAnchorWindow`
- [ ] `addChildWindow`

### 3.2 macOS 27 走系统 session

- [ ] `setupStatusItem()` 在 `#available(macOS 27.0, *)` 里设置 `statusItem.expandedInterfaceDelegate = self`。
- [ ] `statusItem(_:didBegin:)` 在右键时调用 `session.cancel()`，然后 `presentContextMenu()`，并且不创建 panel。
- [ ] 同一次 `didBegin` 的左键调用 `presentExpandedInterfacePanel()`。
- [ ] `statusItemDidEndExpandedInterfaceSession(_:animated:)` 调用 `teardownExpandedInterface()`、`setPopoverVisible(false)` 和 `updateStatsDisplay()`。这个方法里没有 `cancel()`。
- [ ] `presentExpandedInterfacePanel()` 每次先 `teardownExpandedInterface()`，再新建 `NSPanel`。panel 是 `[.borderless, .nonactivatingPanel]`，`hidesOnDeactivate = false`，`level = .statusBar`，`collectionBehavior` 同时包含 `.canJoinAllSpaces` 和 `.fullScreenAuxiliary`。
- [ ] 这个 panel 的位置用 `statusButtonScreenRect` 和 `PopoverPlacementPolicy.originX`，然后 `orderFrontRegardless()` 和 `makeKey()`。该方法里没有 `NSApp.activate`。
- [ ] `presentContextMenu()` 使用 `menu.popUp`，函数体内没有 `statusItem.menu =`。
- [ ] macOS 27 的 `handleClick` 左键直接 return，不调用 `togglePopover()`。
- [ ] `endExpandedInterfaceIfNeeded()` 在 session 还在时只调用 `session.cancel()` 并返回。`closePopoverIfShown()` 在它返回 true 时不再 `performClose`。
- [ ] `handlePopoverDidClose()` 里有 `statusItem.expandedInterfaceSession?.cancel()`。
- [ ] 27 的关闭监视是 `NSEvent.addLocalMonitorForEvents`。点击 `expandedInterfacePanel` 或状态项按钮所在窗口时不关闭。`togglePopover()` 里的全局监视只留在 macOS 27 的提前 return 之后。
- [ ] `updateStatsDisplay()` 在 popover 显示或 `expandedInterfacePanel` 可见时不改 `statusItem.length`。
- [ ] `DashboardWindowController.presentWindow()` 调用 `StatusBarController.dismissMenuBarSurface()`，不再按类名包含 `"Popover"` 去关窗口。
- [ ] `UpdateChecker` 仍通过 `StatusBarController.prepareForSystemAlert()` 进入 `closePopoverIfShown()`。

### 3.3 macOS 12–26 的 popover 还在

这些都在 `togglePopover()` 里，并且位于 macOS 27 的提前 return 之后：

- [ ] `popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)`。
- [ ] `popover.show` 之前，复用窗口插入 `[.canJoinAllSpaces, .fullScreenAuxiliary]`。
- [ ] 打开后 0.5 秒内的关闭切换被吃掉。
- [ ] `popoverAdmitted` 读的是 popover 窗口的 `isOnActiveSpace`，而且这行在 `#available(macOS 26` 之前。
- [ ] 未被当前 Space 接收时，延迟调用 `NSApp.activate`，再调用一次性的 `reshowPopoverOnActiveSpace()`。
- [ ] macOS 26 的玻璃激活先过 `canActivateForPopoverGlass()`，再 `realignPopoverWithButtonIfDisplaced()`。
- [ ] `togglePopover()` 正文里 `NSApp.activate` 正好两处，且都在 `DispatchQueue.main.async` 里，也都在 `window.makeKey()` 之后。
- [ ] `statusButtonScreenRect` 在点击所在屏和按钮真实窗口不在同一块屏时，改用鼠标所在屏。

### 3.4 命令

- [ ] `node --test test/macos-popover-anchor-window.test.js` 通过。
- [ ] `node --test test/macos-background-sync-source.test.js test/macos-limit-reset-celebration.test.js test/localization-regressions.test.js` 通过。
- [ ] `PopoverPlacementPolicy.swift` 和 `PopoverPlacementPolicyTests.swift` 相对实现提交没有行为改动。
- [ ] 全仓 Swift 源码里，菜单栏这条路径不再引用上面第 3.1 节的五个符号。`docs/` 里的旧回顾可以保留这些名字。

### 3.5 明确还没被代码证明的事

agent 要把这些写成「未证实」，不能写成 pass：

- [ ] 右键是否也会触发 `didBegin`。代码两边都处理了，真机顺序没有证明。
- [ ] 设置 delegate 之后，按钮 action 是否仍会派发。
- [ ] `NSGlassEffectView` 在这个 borderless panel 上是否真的画出玻璃。
- [ ] 点击其他 App 时，系统是否会自己结束 session。27 这条路径没有全局鼠标监视。
- [ ] macOS 12–26 的双屏会不会重新出现点一下后跳屏（#193 / #481）。
- [ ] macOS 15 全屏（#681）。

## 4. 结果

### 人工

- 日期：
- 构建：
- 系统：
- 第 2 节：
- 失败现象：

### Agent

- 日期：
- 对照提交：
- 第 3 节：
- 失败项和证据：
