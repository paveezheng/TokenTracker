# 菜单栏弹层迁移到 AppKit 原生展示(删除自建锚点窗口)

**状态:未实施(2026-10-25 记录)。** 本文档是完整可执行的重构方案;实施时基于 `fix/macos-popover-fullscreen-anchor` 分支开新分支 `refactor/native-status-item-expanded-interface`。

## 1. 背景

Issue [#866](https://github.com/xiufengsun/TokenTracker/issues/866):其他 App 原生全屏时,菜单栏弹层不出现;Dashboard 打开期间点过一次图标后,整个进程持续失败。根因已定位(见 `docs/retrospective/TokenTracker/2026-10-22-macos-popover-fullscreen-spaces.md`):

- 弹层挂在应用自建的 2×1pt 无边框锚点窗口上,Popover 以 child window 跟随。
- Dashboard 打开时应用是 `.regular`,普通 `NSWindow` 锚点进不了别的 App 的全屏 Space,且被钉死在当时的桌面 Space;回到 `.accessory` 后不恢复。子弹层跟着锚点,全屏下永远不可见。
- `fix/macos-popover-fullscreen-anchor` 分支(已验证于 macOS 26.7.1)是**补丁式修法**:锚点换成 `.nonactivatingPanel` + 每次打开重建。有效,但自建锚点机制仍然存在。

本方案的目标是按 Apple 原生模式重构,彻底删除锚点机制。

## 2. 已确认的决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| macOS 27+ 呈现 | `NSStatusItem.expandedInterfaceDelegate` + session 回调里展示自定义 `NSPanel` | Apple 规范模式。头文件原文:"The delegate is responsible for showing any expanded interface **such as an NSWindow positioned beneath the item**"。会话内嵌 NSPopover 属非典型用法,无文档背书。 |
| macOS ≤26 呈现 | `popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)` | 旧系统的规范模式,直接相对状态栏按钮定位。 |
| 自建锚点 | 整体删除 | 用户明确要求重构而非打补丁。 |
| 部署目标 | 维持 macOS 12.0(`project.yml` 与 pbxproj 均为 12.0) | 27 API 全部 `#available(macOS 27.0, *)` 门控。 |
| 旧系统双屏风险 | 接受 ≤26 原生路径可能重现 #193/#481 跳屏 | 回顾文档记录 26.7.1 双屏上按钮相对定位 3 次点击 2 次跳屏;保留 realign 兜底,靠外部测试者验收。用户日常在 27.2,不受影响。 |
| 分支 | `refactor/native-status-item-expanded-interface`,基于 `fix/macos-popover-fullscreen-anchor` | 保留回顾文档;上游 main 自分支基点以来未动过 `StatusBarController.swift`(2026-10-25 已核对 v1.4.11),合并无冲突。 |

不采用:SwiftUI `MenuBarExtra`(需 macOS 13、无程序化打开、无右键菜单、放不下合成状态栏标签——结论与回顾文档一致)。

## 3. API 验证结果(2026-10-25,本机 CommandLineTools MacOSX27.0.sdk,探针 typecheck 通过)

```swift
// NSStatusItem (macOS 27.0+,Mac Catalyst 不可用)
weak var expandedInterfaceDelegate: (any NSStatusItemExpandedInterfaceDelegate)?
// session 在 didBegin 前置为有效对象,didEnd 前清空;只读
var expandedInterfaceSession: NSStatusItemExpandedInterfaceSession? { get }

// 协议 NSStatusItemExpandedInterfaceDelegate 两个必需方法(Swift 签名,已验证):
func statusItem(_ statusItem: NSStatusItem, didBegin session: NSStatusItemExpandedInterfaceSession)
func statusItemDidEndExpandedInterfaceSession(_ statusItem: NSStatusItem, animated: Bool)

// NSStatusItemExpandedInterfaceSession 唯一方法:
func cancel()   // 用户以其他方式关闭界面时由 app 调用;之后系统仍会回调 didEnd
```

头文件关键语义:

- **button 上挂着 `NSMenu` 的 status item 收不到 expanded interface 回调**。现有 `showMenu()` 是临时挂载用完即摘,但 27 上右键要改走 session 内处理(见 §5)。
- 协议 conformance 无需显式 `@MainActor`(AppKit 框架级隔离审计)。
- Swift importer 会把 `didBeginExpandedInterfaceSession:` 缩写为 `didBegin`;`statusItemDidEndExpandedInterfaceSession(_:animated:)` 不缩写——拼错会报 conformance 失败。
- `NSPopover.h` / `NSStatusItem.h` 里没有其他 26/27 门控的新 API。

## 4. 现状锚点耦合清单(实施时逐项处理,行号基于 `fix/macos-popover-fullscreen-anchor`)

`StatusBarController.swift`:

- L29 `popoverAnchorWindow: NSPanel?` 属性。
- `makePopoverAnchorWindow`(L1039)、`positionPopoverAnchorWindow`(L1062,含 #481 的多显示器鼠标守卫)、`discardPopoverAnchorWindow`(L1099)。
- `togglePopover`(L838):L852 锚点定位调用;L884-886 `addChildWindow` 挂载。
- `handlePopoverDidClose`(L809):L814-821 detach child + anchor orderOut。
- `closePopoverIfShown`(L149):L154 anchor orderOut。
- `canActivateForPopoverGlass`(L983):以 `popoverAnchorWindow?.screen` 为激活守卫基准。
- `realignPopoverWithAnchorIfDisplaced`(L1005):以 anchor frame 为位移基准。
- `updateStatsDisplay`(L404):弹层显示期间冻结 `statusItem.length`——**保留**,两条路径都仍需要(≤26 锚点是按钮本身,长度变化照样拖动定位)。

外部触点:

- `DashboardWindowController.presentWindow`(L74-75)按 className 含 "Popover" 关弹层窗口——27 的自定义 panel 不匹配,需让打开 Dashboard 时结束活跃 session。
- `UpdateChecker.presentAlert` → `StatusBarController.prepareForSystemAlert()` → `closePopoverIfShown`——27 上需同时 cancel session。
- `DashboardViewModel.setPopoverVisible` 及全部 `isPopoverVisible` 消费者、`PopoverPlacementPolicy` + 其 XCTest(纯数学,不改)、JS 守卫测试(见 §6)。

## 5. 代码改动

### 5.1 删除

§4 列出的锚点属性、三个锚点方法、child-window 挂载、各处 anchor orderOut/detach。

### 5.2 保留(与锚点无关的既有修复,注释里的 issue 号语境原样保留)

- #506:`popover.show` **之前**对复用 `_NSPopoverWindow` 插入 `[.canJoinAllSpaces, .fullScreenAuxiliary]`(Space 分配发生在 show 内,事后插太迟)。
- #372:show 之后对 popover window 补插 collectionBehavior(复用窗口不继承锚点行为)。
- 0.5s debounce(L846):≤26 全屏菜单栏自动隐藏时的双派发防护。
- #681 恢复:`isOnActiveSpace` 检查 + `NSApp.activate` + `reshowPopoverOnActiveSpace` 一次性 latched 恢复(≤26 路径全版本保留)。
- Tahoe glass 延迟激活(macOS 26 门控)+ `canActivateForPopoverGlass`(改为以 `button.window?.screen` 为基准)。
- `realignPopoverWithAnchorIfDisplaced` → 改名 `realignPopoverWithButtonIfDisplaced`:基准从 anchor frame 换成 `button.window` 的 screen frame;`PopoverPlacementPolicy.originX/isDisplaced` 数学不动,直接喂按钮几何。
- 全局 dismiss monitor(≤26)、`refreshForPopoverOpen`、didClose observer 结构、length 冻结。

### 5.3 ≤26 路径改造

```swift
// togglePopover 核心变化:不再经过锚点 view
popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
```

### 5.4 新增 27+ 路径(`@available(macOS 27.0, *)` 隔离的类型/扩展)

- `setupStatusItem` 里设置 `statusItem.expandedInterfaceDelegate = self`(weak,由 controller 长持有)。
- `statusItem(_:didBegin:)`:
  - **右键**(`NSApp.currentEvent?.type == .rightMouseUp`):`session.cancel()`,然后 `menu.popUp(positioning:at:in:)` 在鼠标处弹菜单(复用 `showContextMenuFromIslandGear` 模式;**不**临时挂 `statusItem.menu`,会屏蔽后续回调)。
  - **左键**:每次**新建** expanded panel(Space 绑定不残留,与 fix 分支教训一致):
    - `NSPanel` `[.borderless, .nonactivatingPanel]`、`hidesOnDeactivate = false`、`collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]`、level `.statusBar`;
    - 尺寸 480 × `Self.popoverHeight`,承载独立 `NSHostingController(rootView: DashboardView(viewModel:serverManager:))`(与 popover 共用同一套 view 构造,view 是 struct 可分别构造);
    - 定位在按钮正下方:`button.window.convertToScreen(button.convert(button.bounds, to: nil))` 取按钮几何,x 用 `PopoverPlacementPolicy.originX` 屏幕边缘夹紧;
    - `orderFrontRegardless()` + `makeKey()`、`viewModel.setPopoverVisible(true)`、`Task { await viewModel.refreshForPopoverOpen() }`。
- `statusItemDidEndExpandedInterfaceSession(_:animated:)`:关闭 panel、`setPopoverVisible(false)`、`updateStatsDisplay()`。
- popover `didCloseNotification` 处理里:若 27 且 session 仍活跃 → `session.cancel()`(防御性;27 上 popover 不再是展示壳)。
- `handleClick` 27 保护:`expandedInterfaceSession != nil` 或 didBegin 后 0.5s 内 → 左右键都忽略(系统接管生命周期;若系统仍派发 button action,防止立即自我关闭)。
- 27 上不装全局 dismiss monitor(外部点击关闭由系统 session 驱动)。
- 集成点:`closePopoverIfShown` 与 Dashboard 打开路径,在 27 上若 session 活跃 → `session.cancel()`(didEnd 里统一收尾)。

## 6. 测试改动

`test/macos-popover-anchor-window.test.js`:

- **测试 3 整体重写**(现为"anchored to an app-owned positioning window"):断言 `doesNotMatch` 锚点全套(`popoverAnchorWindow` / `makePopoverAnchorWindow` / `positionPopoverAnchorWindow` / `addChildWindow` / `discardPopoverAnchorWindow`);断言 `popover.show(relativeTo: button.bounds`、`expandedInterfaceDelegate = self`、didBegin 展示 panel、didEnd 收尾、didClose → `session.cancel()`;debounce、`refreshForPopoverOpen`、didClose observer(`queue: .main` + `MainActor.assumeIsolated`)、DashboardViewModel/BackgroundRefreshPolicy 断言原样保留。
- **测试 2** 中锚点耦合断言改写:测试切片边界(L50-51 以 `makePopoverAnchorWindow` 为界)、`addChildWindow`、`positionPopoverAnchorWindow` 鼠标守卫、`anchorWindow.screen` 比较 → 全部换成按钮基准或删除。
- 测试 1 不动;`PopoverPlacementPolicyTests.swift`(XCTest)不动;解析同一 Swift 文件的另外 3 个 JS 测试(背景同步/本地化/庆祝动效)目标代码不触碰,预期不变。

## 7. 验证与风险

1. 本机可跑:`node test/macos-popover-anchor-window.test.js` 及其余 JS 守卫测试;`xcrun swiftc -parse` 语法检查。本机只有 Command Line Tools(无完整 Xcode),编译与真机验证由开发者执行。
2. 真机矩阵(macOS 27.2 本机):回顾文档 Regression check 五步 + 右键菜单 + 全屏 Space(两块屏各放一次全屏 App)+ 多桌面。
3. **三个 device-test 检查点**(27 新路径的不确定项):
   - 27 的 expanded panel 是否被系统自动施加 Liquid Glass;没有则内容外包 `NSGlassEffectView`(注意 `DashboardView` 的 `PopoverSurfaceBackground` 契约:26+ 内容层保持透明)。
   - 右键是否也会触发 session(didBegin 内已处理,验证收敛性)。
   - 设置 delegate 后 button action 是否仍派发(handleClick 保护已双向覆盖,确认即可)。
4. 外部测试者:≤26 双屏(#193/#481 跳屏风险已知情保留,realign 兜底)、macOS 15(#681)。
5. 视觉差异备案:27 panel 无 popover 箭头;如真机不可接受,退路是把 didBegin 的展示从 panel 换成 `popover.show(relativeTo: button...)`(改动局限在一个方法内)。
6. 提交拆分:① `refactor(macos)` 代码;② test 守卫重写;③ 回顾文档 addendum(原生重构决策 + 验证矩阵结果)。PR 到 upstream 时附矩阵结果,回应维护者 triage 评论(2026-10-24)要求的产品/风险决策与专用分支矩阵。
