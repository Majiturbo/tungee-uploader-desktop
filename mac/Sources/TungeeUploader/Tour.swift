import AppKit
import Combine
import SwiftUI

enum TourScene { case idle, scheduled, login, running }

struct TourPoint {
  var symbol: String?
  var dot: RecordingDot.State?
  var badge: String?
  let text: String

  init(_ symbol: String, _ text: String) { self.symbol = symbol; self.text = text }
  init(dot: RecordingDot.State, _ text: String) { self.dot = dot; self.text = text }
  init(badge: String, _ text: String) { self.badge = badge; self.text = text }
}

struct TourStep {
  let page: Step
  let target: String?
  let title: String
  var body: String = ""
  var points: [TourPoint] = []
  var scene: TourScene = .idle

  var chapter: String { page.title }
}

@MainActor
@Observable
final class Tour {
  static let shared = Tour()
  static let doneKey = "tour.v1.done"

  let steps: [TourStep] = [
    TourStep(page: .importFiles, target: nil, title: "欢迎使用",
             body: "用一份示例话术，把整个流程完整走一遍。示例不会动你的文件，随时按 Esc 退出。",
             points: [TourPoint("tray.and.arrow.down", "导入：Excel 话术表 + 录音文件夹"),
                      TourPoint("stethoscope", "体检：检查表格，给录音配对"),
                      TourPoint("scope", "意向：按客户问题建议意向"),
                      TourPoint("icloud.and.arrow.up", "上传：自动填进探迹")]),
    TourStep(page: .importFiles, target: "steps", title: "四个步骤",
             body: "从上往下做，可以随时点回前面的步骤。右边的小字是每一步的状态，比如“已通过”“3 条待确认”。"),
    TourStep(page: .importFiles, target: "files", title: "导入文件",
             body: "拖进窗口任意位置都可以，也可以点“选取”。",
             points: [TourPoint("checkmark.circle.fill", "选好后会显示 Finder 图标和蓝色对勾"),
                      TourPoint("number", "录音会听内容自动对应表格，文件名随意"),
                      TourPoint("waveform", "支持 WAV、MP3、M4A 等常见格式")]),
    TourStep(page: .importFiles, target: "template", title: "下载模板",
             body: "手上没有表格，就先下一份标准模板。直接在模板里填，不要增删列或改表头，否则会检查不过。"),
    TourStep(page: .importFiles, target: "templateGuide", title: "怎么填模板",
             body: "不会填就点这里，四张图讲清楚每一列填什么、从哪一行开始粘贴。"),
    TourStep(page: .importFiles, target: "fields", title: "话术信息",
             points: [TourPoint("text.cursor", "话术名称最多 19 个字，就是探迹里显示的名字"),
                      TourPoint("folder", "知识库分类最多 9 个字，所有问答都放进这个分类")]),
    TourStep(page: .importFiles, target: "primary", title: "检查数据",
             body: "填好后点这里。我会检查表格格式，再听录音内容给每句配上录音。第一次录音多时要一两分钟。"),

    TourStep(page: .checkup, target: "header", title: "一眼看结论",
             body: "大标题直接告诉你能不能传。页面顶部的光也会跟着变色。",
             points: [TourPoint("circle.fill", "蓝色：一切正常"),
                      TourPoint("circle.fill", "橙色：有提醒，不影响上传"),
                      TourPoint("circle.fill", "红色：有错误，要先改")]),
    TourStep(page: .checkup, target: "map", title: "话术结构",
             body: "按话术的真实结构排列，每个点是一条录音。鼠标放在点上能看到编号和文件名。",
             points: [TourPoint(dot: .matched, "已配对"),
                      TourPoint(dot: .converted, "上传前自动剪掉头尾空白，或转成 8k 单声道 WAV"),
                      TourPoint(dot: .missing, "缺录音，只传文字；知识库问题不上传"),
                      TourPoint(dot: .review, "没把握，需要你听一下确认")]),
    TourStep(page: .checkup, target: "row-missing", title: "缺录音",
             body: "点“打开文件夹”补上录音，再重新检查。不补也能传，只是这一条没有声音；知识库问题没有录音会跳过。"),
    TourStep(page: .checkup, target: "row-fix", title: "一键修正",
             body: "重复的问法、多余的语气词、异常符号，都能一键修好。",
             points: [TourPoint("doc.on.doc", "修好的表格另存为新文件，原文件不动"),
                      TourPoint("sparkles", "还可以让本机 AI 查错字、补充问法")]),
    TourStep(page: .checkup, target: "row-matches", title: "录音对应关系",
             body: "核对每条录音配给了哪句话术。按语音内容猜的、没把握的，右上角会出现“确认录音”，逐条听一下就好。"),
    TourStep(page: .checkup, target: "report", title: "导出报告",
             body: "把检查结果存成 Excel，方便发给同事一起改。"),

    TourStep(page: .intent, target: "intentCards", title: "意向建议",
             body: "按知识库里客户会问的问题，建议新增这几条意向。默认的 5 条意向保持不动。",
             points: [TourPoint(badge: "A级", "明确想要，优先跟进"),
                      TourPoint(badge: "B级", "在了解，值得跟进"),
                      TourPoint(badge: "C级", "有顾虑，暂缓")]),
    TourStep(page: .intent, target: "chip-有什么优势", title: "换一个意向",
             body: "带橙点的是我拿不准的问题。点一下，选它该去的意向，建议会立刻更新；换过的会有蓝色描边。"),
    TourStep(page: .intent, target: "schedule", title: "上传时自动设置",
             body: "确认后，上传完会顺手新建这些意向。",
             points: [TourPoint("plus.circle", "只新建，默认的 5 条不改不删"),
                      TourPoint("arrow.uturn.right", "探迹里已有的会跳过"),
                      TourPoint("hand.raised", "任何一步失败，都不会自动提交审核")]),
    TourStep(page: .intent, target: "intentFooter", title: "自己配置也行",
             body: "复制或导出这份建议，照着在探迹里手动设置。"),

    TourStep(page: .upload, target: "uploadSettings", title: "上传设置",
             body: "最后确认一遍话术名称和意向安排。“完成后提交审核”默认关闭，建议传完先在探迹里检查一遍。", scene: .scheduled),
    TourStep(page: .upload, target: "primary", title: "开始上传",
             body: "一切就绪后点这里，会自动打开 Chrome。", scene: .scheduled),
    TourStep(page: .upload, target: "login", title: "登录探迹",
             body: "在 Chrome 中登录探迹后，返回 App 确认登录。",
             points: [TourPoint("globe", "用你自己的探迹账号在 Chrome 里登录"),
                      TourPoint("lock", "账号密码只在 Chrome 里输入，不经过这个工具")], scene: .login),
    TourStep(page: .upload, target: "map", title: "自动上传",
             body: "确认登录后就全自动了：每传完一条，对应的点就亮起来。",
             points: [TourPoint(dot: .done, "已上传"), TourPoint(dot: .active, "正在传"), TourPoint(dot: .pending, "等待"),
                      TourPoint("stop.circle", "想停随时点右上角“停止”，已传的会保留")], scene: .running),
    TourStep(page: .upload, target: "log", title: "运行记录",
             body: "在右边进度下面，每一步都记在这里，最新的在最下面。出了问题，设置里可以打开完整日志发给维护人员。", scene: .running),
    TourStep(page: .upload, target: "inspector", title: "进度",
             body: "右边这一栏随时告诉你四个步骤各做到哪了。", scene: .running),
    TourStep(page: .upload, target: "inspectorToggle", title: "收起进度栏",
             body: "点这个按钮收起或展开右侧进度，页面会更宽。", scene: .running),
    TourStep(page: .upload, target: "settings", title: "设置",
             points: [TourPoint("arrow.counterclockwise", "重新看一遍这个引导"),
                      TourPoint("internaldrive", "清理浏览器缓存、转换后的录音等"),
                      TourPoint("lock.shield", "录音识别、体检、意向建议都在本机完成，不联网")]),
  ]

  private(set) var index: Int?
  var current: TourStep? { index.map { steps[$0] } }
  private(set) var coach: NextStep?
  var follow = false
  var focusTarget: String? { current?.target ?? coach?.target }

  @ObservationIgnored private var anchors: [String: [WeakView]] = [:]
  @ObservationIgnored weak var window: NSWindow?
  @ObservationIgnored private var popover: NSPopover?
  @ObservationIgnored private let popoverDelegate = PopoverDelegate()
  @ObservationIgnored private var blocker: NSView?
  @ObservationIgnored private var showing: Task<Void, Never>?
  @ObservationIgnored private var ticker: Timer?
  @ObservationIgnored private var keyMonitor: Any?

  var shouldAutoStart: Bool { !UserDefaults.standard.bool(forKey: Self.doneKey) }

  func start(at first: Int = 0) {
    let model = AppModel.shared
    if coach != nil { teardown() }
    guard index == nil, !model.busy, let window = window ?? NSApp.mainWindow else { return }
    self.window = window
    model.enterDemo()
    go(to: min(max(first, 0), steps.count - 1))
    present(over: window)
  }

  func next() {
    guard let index else { return }
    if index == steps.count - 1 { finish() } else { go(to: index + 1) }
  }

  func back() {
    guard let index, index > 0 else { return }
    go(to: index - 1)
  }

  func finish() {
    guard index != nil else { return }
    teardown()
    AppModel.shared.exitDemo()
    UserDefaults.standard.set(true, forKey: Self.doneKey)
  }

  // MARK: Next-step guide

  /// Points a popover at the real control for `step`. The page stays usable; clicking elsewhere or Esc closes it.
  func guide(_ step: NextStep) {
    guard index == nil, let window = window ?? NSApp.mainWindow else { return }
    self.window = window
    let starting = coach == nil
    coach = step
    guard starting else { return }
    present(over: window)
    showPopover()
    let timer = Timer(timeInterval: 0.2, repeats: true) { _ in
      MainActor.assumeIsolated { Tour.shared.coachTick() }
    }
    RunLoop.main.add(timer, forMode: .common)
    ticker = timer
  }

  func stopCoach() {
    guard coach != nil else { return }
    teardown()
  }

  func skipCoach() {
    guard let coach else { return }
    AppModel.shared.coachSkipped.insert(coach.id)
    if let next = AppModel.shared.nextStep {
      self.coach = next
      showPopover()
    } else {
      stopCoach()
    }
  }

  func performCoach() {
    guard let action = coach?.help else { return }
    closePopover()
    AppModel.shared.perform(action)
    coachTick()
  }

  private func coachTick() {
    guard let coach, let window else { return }
    let blocked = window.attachedSheet != nil || NSApp.modalWindow != nil || !window.isVisible
    if blocked {
      closePopover()
      return
    }
    let next = AppModel.shared.nextStep
    if next?.id != coach.id {
      if follow, let next {
        self.coach = next
        showPopover()
      } else {
        stopCoach()
      }
    } else if popover?.isShown != true, showing == nil {
      showPopover()
    }
  }

  /// The user closed the coach popover by clicking elsewhere. Unless that click moved things forward, stop.
  private func popoverClosedByUser() {
    guard let coach else { return }
    Task { @MainActor in
      try? await Task.sleep(for: .seconds(0.6))
      guard self.coach?.id == coach.id, AppModel.shared.nextStep?.id == coach.id else { return }
      if self.window?.attachedSheet == nil { self.stopCoach() }
    }
  }

  private func teardown() {
    index = nil
    coach = nil
    showing?.cancel()
    showing = nil
    ticker?.invalidate()
    ticker = nil
    if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
    keyMonitor = nil
    closePopover()
    popover = nil
    blocker?.removeFromSuperview()
    blocker = nil
    window?.makeKeyAndOrderFront(nil)
  }

  private func go(to newIndex: Int) {
    let step = steps[newIndex]
    AppModel.shared.showDemo(step.scene, on: step.page)
    index = newIndex
    showPopover()
    ticker?.invalidate()
    if step.scene == .running, step.target == "map" {
      ticker = Timer.scheduledTimer(withTimeInterval: 0.7, repeats: true) { _ in
        MainActor.assumeIsolated { AppModel.shared.advanceDemoUpload() }
      }
    }
  }

  // MARK: Anchors

  func register(_ id: String, _ view: NSView) {
    anchors[id, default: []].removeAll { $0.view == nil || $0.view === view }
    anchors[id, default: []].append(WeakView(view: view))
  }

  private func views(_ id: String) -> [NSView] {
    (anchors[id] ?? []).compactMap(\.view).filter { $0.window === window && !$0.isHiddenOrHasHiddenAncestor }
  }

  /// Union of all views registered for `id`, in the window's top-left coordinates, clipped to what is visible.
  func rect(for id: String) -> CGRect? {
    guard let window else { return nil }
    let height = window.frame.height
    let rects = views(id).compactMap { view -> CGRect? in
      let inWindow = view.convert(view.bounds, to: nil).intersection(CGRect(origin: .zero, size: window.frame.size))
      guard inWindow.width > 1, inWindow.height > 1 else { return nil }
      return CGRect(x: inWindow.minX, y: height - inWindow.maxY, width: inWindow.width, height: inWindow.height)
    }
    guard let first = rects.first else { return nil }
    return rects.dropFirst().reduce(first) { $0.union($1) }
  }

  /// First visible view registered for `id`.
  private func anchor(_ id: String) -> NSView? {
    guard let window else { return nil }
    let bounds = CGRect(origin: .zero, size: window.frame.size)
    return views(id).first { view in
      let frame = view.convert(view.bounds, to: nil)
      return frame.width > 1 && frame.height > 1 && bounds.intersects(frame)
    }
  }

  // MARK: Popover

  private func present(over window: NSWindow) {
    if coach == nil, let frameView = window.contentView?.superview ?? window.contentView {
      let blocker = ClickBlocker(frame: frameView.bounds)
      blocker.autoresizingMask = [.width, .height]
      frameView.addSubview(blocker, positioned: .above, relativeTo: nil)
      self.blocker = blocker
    }
    keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
      let code = event.keyCode
      let handled = MainActor.assumeIsolated { () -> Bool in
        guard let self else { return false }
        if self.coach != nil {
          guard code == 53 else { return false }
          self.stopCoach()
          return true
        }
        guard self.index != nil else { return false }
        switch code {
        case 53: self.finish()
        case 36, 76, 124: self.next()
        case 123: self.back()
        default: return false
        }
        return true
      }
      return handled ? nil : event
    }
  }

  /// Waits for the target to appear and the page to finish scrolling to it, then points the popover at it.
  private func showPopover() {
    showing?.cancel()
    closePopover()
    showing = Task { @MainActor in
      let id = focusTarget ?? (coach != nil ? "nextStepButton" : "steps")
      var view: NSView?
      for _ in 0..<25 {
        try? await Task.sleep(for: .seconds(0.1))
        guard !Task.isCancelled else { return }
        view = anchor(id)
        if view != nil { break }
      }
      try? await Task.sleep(for: .seconds(0.45))
      guard !Task.isCancelled else { return }
      showing = nil
      guard let view = anchor(id) ?? view, index != nil || coach != nil else { return }
      present(at: view)
    }
  }

  private func present(at view: NSView) {
    let popover = self.popover ?? NSPopover()
    popover.behavior = coach != nil ? .transient : .applicationDefined
    popover.animates = true
    popover.appearance = window?.effectiveAppearance
    popover.delegate = popoverDelegate
    popoverDelegate.closedByUser = { [weak self] in self?.popoverClosedByUser() }
    let controller = NSHostingController(rootView: TourCard().environment(AppModel.shared))
    controller.sizingOptions = .preferredContentSize
    popover.contentViewController = controller
    self.popover = popover
    popover.show(relativeTo: view.bounds, of: view, preferredEdge: edge(for: view))
    popover.contentViewController?.view.window?.makeKey()
  }

  /// Keeps the popover inside the window: under toolbar items, above or below wide targets,
  /// otherwise beside the target on the side with more room.
  private func edge(for view: NSView) -> NSRectEdge {
    guard let window else { return .maxX }
    let frame = view.convert(view.bounds, to: nil)
    let size = window.frame.size
    let below = view.isFlipped ? NSRectEdge.maxY : .minY
    let above = view.isFlipped ? NSRectEdge.minY : .maxY
    if size.height - frame.maxY < 60 { return below }
    if frame.width > size.width * 0.3 { return frame.minY > size.height - frame.maxY ? below : above }
    return size.width - frame.maxX > frame.minX ? .maxX : .minX
  }

  private func closePopover() {
    guard let popover, popover.isShown else { return }
    popoverDelegate.programmatic = true
    popover.close()
  }
}

private final class PopoverDelegate: NSObject, NSPopoverDelegate {
  var programmatic = false
  var closedByUser: (() -> Void)?

  func popoverDidClose(_ notification: Notification) {
    let byUser = !programmatic
    programmatic = false
    if byUser { MainActor.assumeIsolated { closedByUser?() } }
  }
}

/// Invisible layer that keeps clicks from reaching the demo page while the tour runs.
private final class ClickBlocker: NSView {
  override func hitTest(_ point: NSPoint) -> NSView? { frame.contains(point) ? self : nil }
  override func mouseDown(with event: NSEvent) {}
  override func rightMouseDown(with event: NSEvent) {}
  override func scrollWheel(with event: NSEvent) {}
}

private struct WeakView {
  weak var view: NSView?
}

// MARK: - Anchor

extension View {
  /// Marks this view as something the tour can put a spotlight on.
  func tourTarget(_ id: String) -> some View {
    background(TourAnchor(id: id)).id(id)
  }
}

private struct TourAnchor: NSViewRepresentable {
  let id: String

  func makeNSView(context: Context) -> AnchorView {
    let view = AnchorView()
    view.id = id
    return view
  }

  func updateNSView(_ view: AnchorView, context: Context) {
    view.id = id
  }

  final class AnchorView: NSView {
    var id = "" { didSet { register() } }

    override func viewDidMoveToWindow() {
      super.viewDidMoveToWindow()
      register()
    }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    private func register() {
      guard let window, !(window is NSPanel) else { return }
      MainActor.assumeIsolated {
        if Tour.shared.window == nil { Tour.shared.window = window }
        Tour.shared.register(id, self)
      }
    }
  }
}

// MARK: - Card

/// Content of the tour popover: the current tour step, or the next-step coach.
private struct TourCard: View {
  var body: some View {
    let tour = Tour.shared
    Group {
      if let step = tour.current, let index = tour.index {
        stepCard(step, index: index, count: tour.steps.count)
      } else if let coach = tour.coach {
        coachCard(coach)
      }
    }
    .frame(width: 320, alignment: .leading)
    .padding(18)
    .secondaryGlass()
  }

  private func stepCard(_ step: TourStep, index: Int, count: Int) -> some View {
    let last = index == count - 1
    return VStack(alignment: .leading, spacing: 10) {
      VStack(alignment: .leading, spacing: 6) {
        HStack {
          Text(step.chapter).font(.caption.weight(.semibold)).foregroundStyle(Color.accentColor)
          Spacer()
          Text("\(index + 1) / \(count)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
        ProgressView(value: Double(index + 1), total: Double(count))
          .progressViewStyle(.linear)
          .controlSize(.small)
      }
      Text(step.title).font(.system(size: 22, weight: .semibold, design: .serif))
      if !step.body.isEmpty {
        Text(step.body).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
      }
      if !step.points.isEmpty {
        VStack(alignment: .leading, spacing: 8) {
          ForEach(Array(step.points.enumerated()), id: \.offset) { offset, point in
            HStack(alignment: .firstTextBaseline, spacing: 10) {
              pointIcon(point, index: offset, step: step).frame(width: 30, alignment: .center)
              Text(point.text).fixedSize(horizontal: false, vertical: true)
            }
          }
        }
        .font(.callout)
      }
      HStack {
        if !last { Button("跳过") { Tour.shared.finish() }.buttonStyle(.link) }
        Spacer()
        if index > 0 { Button("上一步") { Tour.shared.back() } }
        Button(last ? "开始使用" : "下一步") { Tour.shared.next() }.prominentGlass()
      }
      .padding(.top, 6)
    }
  }

  private func coachCard(_ step: NextStep) -> some View {
    @Bindable var tour = Tour.shared
    return VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 8) {
        Text("下一步").font(.caption.weight(.semibold)).foregroundStyle(Color.accentColor)
        if step.optional { Text("可以跳过").font(.caption).foregroundStyle(.secondary) }
      }
      Text(step.title).font(.system(size: 22, weight: .semibold, design: .serif))
      if !step.body.isEmpty {
        Text(step.body).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
      }
      Toggle("一路带到上传", isOn: $tour.follow)
        .toggleStyle(.checkbox)
        .font(.callout)
        .help("做完一步自动指下一步")
      HStack {
        Spacer()
        if step.optional { Button("跳过") { tour.skipCoach() } }
        if let help = step.help {
          Button(help.label) { tour.performCoach() }.prominentGlass()
        } else if step.waiting || step.target == nil {
          Button("知道了") { tour.stopCoach() }.prominentGlass()
        } else {
          Button("知道了") { tour.stopCoach() }
        }
      }
      .padding(.top, 4)
    }
  }

  @ViewBuilder private func pointIcon(_ point: TourPoint, index: Int, step: TourStep) -> some View {
    if let dot = point.dot {
      RecordingDot(state: dot)
    } else if let badge = point.badge {
      Text(badge)
        .font(.caption.weight(.semibold))
        .foregroundStyle(badge == "A级" ? Color.accentColor : badge == "B级" ? .indigo : .secondary)
    } else if let symbol = point.symbol {
      let moodTints: [Color] = [.blue, .orange, .red]
      Image(systemName: symbol)
        .foregroundStyle(step.target == "header" ? moodTints[min(index, 2)] : Color.accentColor)
        .font(step.target == "header" ? .system(size: 9) : .callout)
    }
  }
}
