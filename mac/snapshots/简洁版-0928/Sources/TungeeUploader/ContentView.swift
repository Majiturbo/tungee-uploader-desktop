import SwiftUI

extension View {
  @ViewBuilder func prominentGlass(_ enabled: Bool = true) -> some View {
    if #available(macOS 26, *) {
      if enabled { buttonStyle(.glassProminent) } else { buttonStyle(.glass) }
    } else {
      buttonStyle(.borderedProminent)
    }
  }
}

struct ContentView: View {
  @Environment(AppModel.self) private var model
  @State private var settingsOpen = false

  var body: some View {
    @Bindable var model = model
    NavigationSplitView {
      List(selection: Binding<Step?>(get: { model.step }, set: { if let step = $0 { model.step = step } })) {
        ForEach(Step.allCases) { step in
          Label(step.title, systemImage: step.symbol)
            .badge(model.status(of: step).isEmpty ? nil : Text(model.status(of: step)))
            .tag(step)
        }
      }
      .safeAreaInset(edge: .bottom) {
        Button { settingsOpen = true } label: {
          Label("设置", systemImage: "gearshape")
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 20)
        .padding(.bottom, 14)
      }
      .navigationSplitViewColumnWidth(min: 190, ideal: 210, max: 260)
    } detail: {
      ZStack(alignment: .top) {
        PageBackground()
        if let mood {
          AmbientLight(mood: mood)
            .frame(maxWidth: .infinity)
            .frame(height: 380)
            .ignoresSafeArea(edges: .top)
        }
        HStack(spacing: 0) {
          page.frame(maxWidth: .infinity)
          if model.showInspector {
            InspectorView()
              .frame(width: 240)
              .transition(.move(edge: .trailing).combined(with: .opacity))
          }
        }
      }
      .animation(.easeOut(duration: 0.2), value: model.showInspector)
      .navigationTitle(model.step.title)
      .hidingToolbarTitle()
      .toolbar { toolbar }
      .immersiveToolbar()
    }
    .dropDestination(for: URL.self) { urls, _ in model.drop(urls) }
    .sheet(item: $model.matchMode) { mode in
      if let summary = model.summary {
        AudioMatchSheet(match: summary.audioMatch, initialMode: mode)
      }
    }
    .sheet(isPresented: $model.checkupOpen) {
      if let summary = model.summary {
        CheckupSheet(checkup: summary.checkup)
      }
    }
    .sheet(isPresented: $settingsOpen) { SettingsSheet() }
  }

  private var concept: Bool { CommandLine.arguments.contains("--concept") }

  private var mood: AmbientLight.Mood? {
    guard concept, model.step == .checkup, let summary = model.summary else { return nil }
    return CheckupConcept.mood(summary)
  }

  @ViewBuilder private var page: some View {
    switch model.step {
    case .importFiles: ImportView()
    case .checkup:
      if concept, let summary = model.summary {
        CheckupConcept(summary: summary)
      } else {
        CheckupView()
      }
    case .intent, .upload:
      ContentUnavailableView(model.step.title, systemImage: model.step.symbol, description: Text("这一页还在迁移中。"))
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
      }
      Button("详细信息", systemImage: "sidebar.right") { model.showInspector.toggle() }
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
      row("录音配对", matchStatus, state: model.stage == .matching ? .active : model.summary == nil ? .pending : .done)
      row("话术体检", checkupStatus, state: model.checking && model.stage != .matching ? .active : model.summary == nil ? .pending : .done)
      row("意向建议", model.summary == nil ? "等待导入" : "未生成", state: .pending)
      row("上传", model.uploading ? model.stage.title : model.stage == .completed ? "已完成" : "未开始",
          state: model.uploading ? .active : model.stage == .completed ? .done : .pending, last: true)
      Spacer()
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
    if !summary.audioMatch.smart { return "按编号" }
    return model.pendingMatches > 0 ? "\(model.pendingMatches) 条待确认" : "已完成"
  }

  private var checkupStatus: String {
    if model.checking { return "检查中" }
    guard model.summary != nil else { return "等待导入" }
    return model.checkupCounts.total > 0 ? "\(model.checkupCounts.total) 项" : "无问题"
  }

  private func row(_ title: String, _ status: String, state: RowState, last: Bool = false) -> some View {
    HStack(alignment: .top, spacing: 12) {
      VStack(spacing: 0) {
        ZStack {
          switch state {
          case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(.tint)
          case .active: ProgressView().controlSize(.mini)
          case .pending: Image(systemName: "circle").foregroundStyle(.tertiary)
          }
        }
        .font(.system(size: 14))
        .frame(width: 16, height: 18)
        if !last {
          Rectangle().fill(.separator).frame(width: 1).frame(maxHeight: .infinity).padding(.vertical, 3)
        }
      }
      VStack(alignment: .leading, spacing: 2) {
        Text(title).foregroundStyle(state == .pending ? .secondary : .primary)
        Text(status).font(.callout).foregroundStyle(.secondary)
      }
      .padding(.bottom, last ? 0 : 18)
    }
    .fixedSize(horizontal: false, vertical: true)
  }
}
