import SwiftUI

extension View {
  @ViewBuilder func prominentGlass(_ enabled: Bool = true) -> some View {
    if #available(macOS 26, *) {
      if enabled { buttonStyle(.glassProminent).buttonBorderShape(.capsule) } else { buttonStyle(.glass).buttonBorderShape(.capsule) }
    } else {
      buttonStyle(.borderedProminent)
    }
  }

  /// Glass capsules for ordinary buttons. Applied at page and sheet roots so every unstyled button inherits it;
  /// the system would otherwise pick rounded rectangles for regular sizes and capsules for large ones.
  @ViewBuilder func secondaryGlass() -> some View {
    if #available(macOS 26, *) { buttonStyle(.glass).buttonBorderShape(.capsule) } else { self }
  }
}

extension AnyTransition {
  /// The old page steps away quickly so the two never read on top of each other; the new one rises a little and
  /// comes into focus.
  static var pageSwap: AnyTransition {
    .asymmetric(
      insertion: .modifier(active: PageSettle(amount: 1), identity: PageSettle(amount: 0))
        .animation(.smooth(duration: 0.42).delay(0.08)),
      removal: .modifier(active: PageSettle(amount: -0.4), identity: PageSettle(amount: 0))
        .animation(.easeIn(duration: 0.14))
    )
  }
}

/// 0 is the page at rest; positive sits lower and blurred, negative lifts it away. Both fade.
private struct PageSettle: ViewModifier {
  let amount: CGFloat

  func body(content: Content) -> some View {
    content
      .opacity(amount == 0 ? 1 : 0)
      .offset(y: amount * 12)
      .blur(radius: abs(amount) * 6)
  }
}

struct ContentView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    @Bindable var model = model
    NavigationSplitView {
      List(selection: Binding<Step?>(get: { model.step }, set: { if let step = $0 { model.step = step } })) {
        Section {
          ForEach(model.steps) { step in
            Label(step.title, systemImage: step.symbol)
              .frame(maxWidth: .infinity, alignment: .leading)
              .tourTarget("nav-\(step.rawValue)")
              .badge(model.status(of: step).isEmpty ? nil : Text(model.status(of: step)))
              .tag(step)
          }
        } header: {
          Text(model.isVoiceAgent ? "配置语音 Agent" : model.isModify ? "修改已有话术" : "新建话术")
            .contentTransition(.opacity)
        }
      }
      .tourTarget("steps")
      .safeAreaInset(edge: .top) {
        HStack(spacing: 16) {
          productTab("话术上传", selected: !model.isVoiceAgent) { model.setProduct(.talk) }
          productTab("语音 Agent", selected: model.isVoiceAgent) { model.setProduct(.voiceAgent) }
        }
        .disabled(model.busy)
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 6)
      }
      .safeAreaInset(edge: .bottom) {
        Button { model.settingsOpen = true } label: {
          Label("设置", systemImage: "gearshape")
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.borderless)
        .foregroundStyle(.secondary)
        .tourTarget("settings")
        .padding(.horizontal, 20)
        .padding(.bottom, 14)
      }
      .navigationSplitViewColumnWidth(min: 190, ideal: 210, max: 260)
    } detail: {
      ZStack(alignment: .top) {
        ZStack(alignment: .top) {
          PageBackground()
          AmbientLight(mood: mood)
            .frame(maxWidth: .infinity)
            .frame(height: 420)
            .ignoresSafeArea(edges: .top)
        }
        .extendingUnderSidebar()
        HStack(spacing: 0) {
          page
            .frame(maxWidth: .infinity)
            .id(model.step)
            .transition(.pageSwap)
          if model.showInspector {
            InspectorView()
              .tourTarget("inspector")
              .frame(width: 240)
              .transition(.move(edge: .trailing).combined(with: .opacity))
          }
        }
        .secondaryGlass()
      }
      .animation(.smooth(duration: 0.35), value: model.step)
      .animation(.smooth(duration: 0.3), value: model.showInspector)
      .navigationTitle(model.step.title)
      .hidingToolbarTitle()
      .toolbar { toolbar }
      .immersiveToolbar()
    }
    .dropDestination(for: URL.self) { urls, _ in model.drop(urls) }
    .sheet(item: $model.matchMode) { mode in
      if let summary = model.summary {
        AudioMatchSheet(summary: summary, initialMode: mode, focus: model.matchFocus)
          .onDisappear { model.matchFocus = nil }
      }
    }
    .sheet(isPresented: $model.checkupOpen) {
      if let summary = model.summary {
        CheckupSheet(checkup: summary.checkup)
      }
    }
    .sheet(isPresented: $model.settingsOpen) { SettingsSheet() }
    .sheet(isPresented: $model.templateGuideOpen) {
      TemplateGuideSheet(page: (DevScript.value("--page").flatMap(Int.init) ?? 1) - 1)
    }
    .task {
        guard Tour.shared.shouldAutoStart, DevScript.value("--shot") == nil, DevScript.value("--tour") == nil, DevScript.value("--pack") == nil else { return }
      try? await Task.sleep(for: .seconds(0.8))
      // The installer opens the app behind its own window, and a remembered file set may start a check right away;
      // wait until the user is actually looking at an idle window.
      while !Task.isCancelled, Tour.shared.current == nil, Tour.shared.shouldAutoStart {
        if NSApp.isActive, NSApp.mainWindow != nil, !model.busy { Tour.shared.start() }
        try? await Task.sleep(for: .seconds(0.5))
      }
    }
  }

  private func productTab(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(title)
        .font(.subheadline.weight(selected ? .semibold : .regular))
        .foregroundStyle(selected ? Color.primary : Color.secondary)
    }
    .buttonStyle(.plain)
  }

  private var mood: AmbientLight.Mood {
    if model.isVoiceAgent {
      switch model.step {
      case .importFiles: return VoiceImportView.mood(model)
      case .packReview: return model.voicePreview.map(VoicePreviewView.mood) ?? (model.error != nil ? .error : .calm)
      case .upload: return VoiceUploadView.mood(model)
      default: return .calm
      }
    }
    switch model.step {
    case .importFiles: return ImportView.mood(model)
    case .checkup: return model.summary.map { CheckupView.mood($0, modify: model.isModify) } ?? (model.error != nil ? .error : .calm)
    case .intent: return IntentView.mood(model)
    case .upload: return UploadView.mood(model)
    case .compare: return CompareView.mood(model)
    case .modify: return ModifyView.mood(model)
    case .packReview: return .calm
    }
  }

  @ViewBuilder private var page: some View {
    if model.isVoiceAgent {
      switch model.step {
      case .packReview: VoicePreviewView()
      case .upload: VoiceUploadView()
      default: VoiceImportView()
      }
    } else {
      switch model.step {
      case .importFiles: ImportView()
      case .checkup: CheckupView()
      case .intent: IntentView()
      case .upload: UploadView()
      case .compare: CompareView()
      case .modify: ModifyView()
      case .packReview: ImportView()
      }
    }
  }

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    if #available(macOS 26, *) {
      ToolbarSpacer(.flexible, placement: .primaryAction)
    }
    ToolbarItemGroup(placement: .primaryAction) {
      if model.step == .checkup, model.summary != nil {
        Button("导出报告", systemImage: "square.and.arrow.down") { Task { await model.saveReport() } }
          .disabled(model.reportSaving)
          .tourTarget("report")
      }
      Button("详细信息", systemImage: "sidebar.right") { model.showInspector.toggle() }
        .tourTarget("inspectorToggle")
    }
    if #available(macOS 26, *) {
      ToolbarSpacer(.fixed, placement: .primaryAction)
    }
    ToolbarItem(placement: .primaryAction) {
      let action = model.primaryAction()
      Button(action: action.run) {
        if model.checking { ProgressView().controlSize(.small) }
        Text(action.label)
      }
      .prominentGlass(action.enabled)
      .disabled(!action.enabled)
      .tourTarget("primary")
    }
  }
}

struct Banners: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    if model.sidecarFailed != nil || model.error != nil || model.notice != nil {
      VStack(spacing: 10) {
        if let failed = model.sidecarFailed {
          Callout(symbol: "xmark.octagon.fill", tint: .red, title: failed)
        }
        if let error = model.error {
          Callout(symbol: "xmark.octagon.fill", tint: .red, title: error.message, detail: error.suggestion) {
            if let detail = error.detail {
              DisclosureGroup("技术详情 · \(error.code)") {
                Text(detail).font(.caption.monospaced()).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
              }
              .font(.callout)
            }
          }
          .tourTarget("error")
        }
        if let notice = model.notice {
          Callout(symbol: "checkmark.circle.fill", tint: .green, title: notice)
            .task(id: notice) {
              try? await Task.sleep(for: .seconds(5))
              if model.notice == notice { model.notice = nil }
            }
        }
      }
      .transition(.move(edge: .top).combined(with: .opacity))
    }
  }
}

struct Callout<Extra: View>: View {
  let symbol: String
  let tint: Color
  let title: String
  var detail: String?
  @ViewBuilder var extra: Extra

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      Image(systemName: symbol).font(.title3).foregroundStyle(tint)
      VStack(alignment: .leading, spacing: 3) {
        Text(title).fontWeight(.semibold)
        if let detail { Text(detail).foregroundStyle(.secondary) }
        extra
      }
      Spacer(minLength: 0)
    }
  }
}

extension Callout where Extra == EmptyView {
  init(symbol: String, tint: Color, title: String, detail: String? = nil) {
    self.init(symbol: symbol, tint: tint, title: title, detail: detail) { EmptyView() }
  }
}

struct Banner: View {
  let symbol: String
  let tint: Color
  let title: String
  var detail: String?

  var body: some View {
    Label {
      VStack(alignment: .leading, spacing: 2) {
        Text(title).fontWeight(.semibold)
        if let detail { Text(detail).foregroundStyle(.secondary) }
      }
    } icon: {
      Image(systemName: symbol).foregroundStyle(tint)
    }
  }
}

struct InspectorView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("进度").font(.headline).padding(.bottom, 14)
      if model.isVoiceAgent {
        row("交付包", model.voiceConfig.packPath.isEmpty ? "等待导入" : "已添加",
            state: model.voiceConfig.packPath.isEmpty ? .pending : .done)
        row("结构校验", voiceCheckStatus,
            state: model.checking ? .active : model.voicePreview == nil ? .pending : .done)
        row("上传", uploadStatus,
            state: model.voiceUploading ? .active : model.stage == .completed ? .done : .pending, last: true)
      } else {
        row("录音配对", matchStatus, state: model.stage == .matching ? .active : model.summary == nil ? .pending : .done)
        row("话术体检", checkupStatus, state: model.checking && model.stage != .matching ? .active : model.summary == nil ? .pending : .done)
        if model.isModify {
          row("线上对比", compareStatus, state: model.comparing ? .active : model.modifyPlan != nil ? .done : .pending)
          row("修改", modifyStatus,
              state: model.modifying ? .active : model.stage == .completed && model.modifyMessage != nil ? .done : .pending, last: true)
        } else {
          row("意向建议", intentStatus, state: model.intentLoading ? .active : model.intentResult != nil || model.scheduledIntents != nil ? .done : .pending)
          row("上传", uploadStatus,
              state: model.uploading ? .active : model.stage == .completed ? .done : .pending, last: true)
        }
      }
      if model.logs.isEmpty {
        Spacer()
      } else {
        RunLog().tourTarget("log").padding(.top, 36)
      }
    }
    .padding(.top, 44)
    .padding(.trailing, 28)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private enum RowState { case pending, active, done }


  private var matchStatus: String {
    if model.stage == .matching {
      if let current = model.progress.current, let total = model.progress.total { return "\(current)/\(total)" }
      return "识别中"
    }
    guard let summary = model.summary else { return "等待导入" }
    if !summary.audioMatch.smart, !model.isModify { return "按编号" }
    return model.pendingMatches > 0 ? "\(model.pendingMatches) 条待确认" : "已完成"
  }

  private var uploadStatus: String {
    if model.uploading {
      if let current = model.progress.current, let total = model.progress.total { return "\(model.stage.title) \(current)/\(total)" }
      return model.stage.title
    }
    switch model.stage {
    case .completed: return "已完成"
    case .error: return "未完成"
    case .cancelled: return "已停止"
    default: return "未开始"
    }
  }

  private var runningStatus: String {
    if let current = model.progress.current, let total = model.progress.total { return "\(model.stage.title) \(current)/\(total)" }
    return model.stage.title
  }

  private var compareStatus: String {
    if model.comparing { return runningStatus }
    return model.modifyPlan == nil ? "未开始" : "\(model.selectedItems.count) 处要改"
  }

  private var modifyStatus: String {
    if model.modifying { return runningStatus }
    guard model.modifyMessage != nil else { return "未开始" }
    switch model.stage {
    case .completed: return "已完成"
    case .error: return "未完成"
    case .cancelled: return "已停止"
    default: return "未开始"
    }
  }

  private var intentStatus: String {
    if model.intentLoading {
      if let progress = model.intentProgress, progress.total > 0 { return "\(progress.current)/\(progress.total)" }
      return "分析中"
    }
    if let scheduled = model.scheduledIntents { return "上传时新建 \(scheduled.count) 条" }
    if let result = model.intentResult { return result.plan.cards.isEmpty ? "无需新增" : "建议 \(result.plan.cards.count) 条" }
    if model.summary?.knowledgeCount == 0 { return "无需设置" }
    return model.summary == nil ? "等待导入" : "未生成"
  }

  private var checkupStatus: String {
    if model.checking { return "检查中" }
    guard model.summary != nil else { return "等待导入" }
    return model.checkupCounts.total > 0 ? "\(model.checkupCounts.total) 项" : "无问题"
  }

  private var voiceCheckStatus: String {
    if model.checking { return "核对中" }
    guard let preview = model.voicePreview else { return "等待导入" }
    return preview.canUpload ? "已通过" : "\(preview.errorCount) 处"
  }

  private func row(_ title: String, _ status: String, state: RowState, last: Bool = false) -> some View {
    Label {
      VStack(alignment: .leading, spacing: 2) {
        Text(title).foregroundStyle(state == .pending ? .secondary : .primary)
        Text(status).font(.callout).foregroundStyle(.secondary).contentTransition(.numericText())
      }
    } icon: {
      ZStack {
        switch state {
        case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(.tint).transition(.scale(0.5).combined(with: .opacity))
        case .active: ProgressView().controlSize(.mini).transition(.opacity)
        case .pending: Image(systemName: "circle").foregroundStyle(.tertiary).transition(.opacity)
        }
      }
    }
    .padding(.bottom, last ? 0 : 16)
    .animation(.smooth(duration: 0.3), value: state)
    .animation(.smooth(duration: 0.3), value: status)
  }
}

/// Newest-last run log in the progress column; follows new lines as they arrive.
struct RunLog: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("运行记录").font(.headline)
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 10) {
            ForEach(Array(model.logs.enumerated()), id: \.offset) { index, event in
              VStack(alignment: .leading, spacing: 1) {
                Text(RunLog.time(event.timestamp)).font(.caption.monospacedDigit()).foregroundStyle(.tertiary)
                Text(event.message)
                  .font(.callout)
                  .foregroundStyle(event.stage == "error" ? AnyShapeStyle(.red) : index == model.logs.count - 1 ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
                  .fixedSize(horizontal: false, vertical: true)
              }
              .frame(maxWidth: .infinity, alignment: .leading)
              .id(index)
            }
          }
          .padding(.bottom, 20)
        }
        .scrollIndicators(.automatic)
        .onAppear { proxy.scrollTo(model.logs.count - 1, anchor: .bottom) }
        .onChange(of: model.logs.count) { _, count in
          withAnimation(.smooth) { proxy.scrollTo(count - 1, anchor: .bottom) }
        }
      }
    }
    .frame(maxHeight: .infinity, alignment: .top)
  }

  static func time(_ timestamp: String) -> String {
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = parser.date(from: timestamp) ?? ISO8601DateFormatter().date(from: timestamp) else { return "" }
    return date.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).second(.twoDigits))
  }
}
