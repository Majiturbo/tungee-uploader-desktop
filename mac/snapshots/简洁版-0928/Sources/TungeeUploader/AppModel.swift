import AppKit
import Observation
import SwiftUI

enum Step: String, CaseIterable, Identifiable {
  case importFiles, checkup, intent, upload
  var id: Self { self }

  var title: String {
    switch self {
    case .importFiles: "导入"
    case .checkup: "体检"
    case .intent: "意向"
    case .upload: "上传"
    }
  }

  var symbol: String {
    switch self {
    case .importFiles: "tray.and.arrow.down"
    case .checkup: "stethoscope"
    case .intent: "scope"
    case .upload: "icloud.and.arrow.up"
    }
  }
}

enum MatchMode: String, Identifiable {
  case review, list
  var id: Self { self }
}

struct Notice: Equatable {
  var text: String
  var isError = false
  var detail: String?
}

@MainActor
@Observable
final class AppModel {
  static let shared = AppModel()

  var config = UploadConfig()
  var summary: PreviewSummary?
  var stage: Stage = .idle
  var progress: (current: Int?, total: Int?) = (nil, nil)
  var logs: [ProgressEvent] = []
  var error: AppErrorInfo?
  var notice: String?
  var step: Step = .importFiles
  var showInspector = true
  var checking = false
  var reportSaving = false
  var matchMode: MatchMode?
  var checkupOpen = false
  var sidecarFailed: String?

  let sidecar = Sidecar()

  private init() {
    sidecar.onProgress = { [weak self] event in self?.received(event) }
    sidecar.onExit = { [weak self] status in
      guard let self, status != 0 else { return }
      self.sidecarFailed = "后台服务意外退出（\(status)）。请重新打开本工具。"
    }
    do {
      try sidecar.start()
    } catch {
      sidecarFailed = "后台服务启动失败：\(error.localizedDescription)"
    }
  }

  // MARK: Derived state

  var isRunning: Bool { stage.isRunning }
  var uploading: Bool { stage.isRunning && stage.isUpload }
  var busy: Bool { isRunning || checking }

  var canRun: Bool {
    !config.workbookPath.isEmpty && !config.audioDir.isEmpty
      && !config.talkName.isEmpty && config.talkName.count < 20
      && !config.categoryName.isEmpty && config.categoryName.count < 10
  }

  var canStart: Bool { canRun && summary?.canUpload == true }
  var pendingMatches: Int { summary?.canUpload == true ? summary?.audioMatch.reviewCount ?? 0 : 0 }

  var checkupCounts: (total: Int, fixable: Int, hints: Int) {
    let findings = summary?.checkup.findings ?? []
    let fixable = findings.filter { !$0.options.isEmpty }.count
    return (findings.count, fixable, findings.count - fixable)
  }

  var subtitle: String {
    config.workbookPath.isEmpty ? "未导入" : URL(fileURLWithPath: config.workbookPath).lastPathComponent
  }

  func status(of step: Step) -> String {
    switch step {
    case .importFiles:
      return !config.workbookPath.isEmpty && !config.audioDir.isEmpty ? "已添加" : ""
    case .checkup:
      if checking { return "检查中" }
      guard let summary else { return "" }
      if !summary.canUpload { return "\(summary.errorCount) 个错误" }
      return pendingMatches > 0 ? "\(pendingMatches) 条待确认" : "已通过"
    case .intent:
      return ""
    case .upload:
      return uploading ? stage.title : stage == .completed ? "已完成" : ""
    }
  }

  // MARK: Actions

  func update(_ change: (inout UploadConfig) -> Void) {
    let before = config
    change(&config)
    if before.workbookPath != config.workbookPath || before.audioDir != config.audioDir {
      summary = nil
      stage = .idle
    }
    if [.error, .cancelled, .completed].contains(stage) { stage = .idle }
    error = nil
  }

  func chooseWorkbook() {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.init(filenameExtension: "xlsx")!]
    panel.message = "选取话术表格"
    if panel.runModal() == .OK, let url = panel.url { update { $0.workbookPath = url.path } }
  }

  func chooseAudioDir() {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.message = "选取录音文件夹"
    if panel.runModal() == .OK, let url = panel.url { update { $0.audioDir = url.path } }
  }

  func drop(_ urls: [URL]) -> Bool {
    guard !busy else { return false }
    var accepted = false
    for url in urls {
      var isDirectory: ObjCBool = false
      guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else { continue }
      if isDirectory.boolValue {
        update { $0.audioDir = url.path }
        accepted = true
      } else if url.pathExtension.lowercased() == "xlsx" {
        update { $0.workbookPath = url.path }
        accepted = true
      }
    }
    if !accepted {
      error = AppErrorInfo(code: "E-DROP-003", message: "无法识别拖入的内容。", suggestion: "请拖入 .xlsx 话术表格，或包含录音的文件夹。")
    }
    step = .importFiles
    return accepted
  }

  @discardableResult
  func preview(_ target: UploadConfig? = nil) async -> PreviewSummary? {
    error = nil
    checking = true
    defer { checking = false }
    do {
      let result: ServiceResult<SummaryPayload> = try await sidecar.call("automation:preview", target ?? config)
      if let summary = result.payload?.summary {
        self.summary = summary
        return summary
      }
      error = result.error
      stage = .error
    } catch {
      self.error = .bridge(error)
      stage = .error
    }
    return nil
  }

  func runCheck() async {
    if await preview() != nil { step = .checkup }
  }

  func saveTemplate() async {
    await saveFile("template:save", success: "标准模板已保存")
  }

  func saveReport() async {
    reportSaving = true
    defer { reportSaving = false }
    await saveFile("report:validation", config, success: "检查报告已保存")
  }

  private func saveFile(_ method: String, _ params: Encodable..., success: String) async {
    error = nil
    do {
      let result: ServiceResult<NoPayload>
      if let first = params.first {
        result = try await sidecar.call(method, first)
      } else {
        result = try await sidecar.call(method)
      }
      if result.status == "saved", let path = result.path {
        notice = "\(success)：\(URL(fileURLWithPath: path).lastPathComponent)"
      } else if let failure = result.error {
        error = failure
      }
    } catch {
      self.error = .bridge(error)
    }
  }

  func matchesSaved() {
    matchMode = nil
    notice = "录音匹配已保存"
    Task { await preview() }
  }

  func useFixedWorkbook(_ path: String) {
    checkupOpen = false
    update { $0.workbookPath = path }
    notice = "已改用修正版：\(URL(fileURLWithPath: path).lastPathComponent)"
    Task { await preview() }
  }

  func primaryAction() -> (label: String, enabled: Bool, run: () -> Void) {
    switch step {
    case .importFiles:
      return (checking ? "检查中…" : "检查数据", canRun && !busy, { Task { await self.runCheck() } })
    case .checkup:
      guard let summary else { return ("检查数据", canRun && !busy, { Task { await self.runCheck() } }) }
      if pendingMatches > 0 { return ("确认录音（\(pendingMatches)）", !busy, { self.matchMode = .review }) }
      return ("下一步：意向", summary.canUpload && !busy, { self.step = .intent })
    case .intent:
      return ("下一步：上传", canStart && !busy, { self.step = .upload })
    case .upload:
      return ("开始上传", false, {})
    }
  }

  private func received(_ event: ProgressEvent) {
    stage = Stage(rawValue: event.stage) ?? .idle
    progress = (event.current, event.total)
    logs = Array((logs + [event]).suffix(200))
    if stage == .error { error = event.error ?? AppErrorInfo(code: "E-UNKNOWN-001", message: event.message, suggestion: "请重新检查数据后再试。") }
    if stage == .completed { error = nil }
  }
}
