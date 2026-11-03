import AppKit
import Observation
import SwiftUI
import UniformTypeIdentifiers

enum Product: String, Hashable {
  case talk, voiceAgent
}

enum Step: String, CaseIterable, Identifiable {
  case importFiles, checkup, intent, upload, compare, modify, packReview
  var id: Self { self }

  static let create: [Step] = [.importFiles, .checkup, .intent, .upload]
  static let modifying: [Step] = [.importFiles, .checkup, .compare, .modify]
  static let voiceAgent: [Step] = [.importFiles, .packReview, .upload]

  var title: String {
    switch self {
    case .importFiles: "导入"
    case .checkup: "体检"
    case .intent: "意向"
    case .upload: "上传"
    case .compare: "对比"
    case .modify: "修改"
    case .packReview: "核对"
    }
  }

  var symbol: String {
    switch self {
    case .importFiles: "tray.and.arrow.down"
    case .checkup: "stethoscope"
    case .intent: "scope"
    case .upload: "icloud.and.arrow.up"
    case .compare: "arrow.left.arrow.right"
    case .modify: "square.and.pencil"
    case .packReview: "checkmark.seal"
    }
  }
}

enum ModifyTask { case compare, modify }

enum MatchMode: String, Identifiable {
  case review, list, trim
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
  /** Row the match sheet scrolls to when it opens from a recording's card. */
  var matchFocus: Int?
  var checkupOpen = false
  /** Tab the checkup sheet opens on next time, e.g. "few" or "qa". */
  var checkupTab: String?
  var sidecarFailed: String?

  var intentAnalysis: IntentAnalysis?
  var intentQuestions: [IntentQuestion] = []
  var intentResult: IntentPlanResult?
  var intentLoading = false
  var intentProgress: AiProgress?
  var intentError: AppErrorInfo?
  var scheduledIntents: [IntentSetup]?

  var uploadDone: Set<Int> = []
  var uploadActive: Int?
  var uploadMessage: String?
  var checkpoint: UploadCheckpointInfo?
  var renameDraft = ""
  var saved: SessionSnapshot?
  var coachSkipped: Set<String> = []
  var focusRequest: String?
  var intentConfirming = false
  var settingsOpen = false
  var templateGuideOpen = false
  var product: Product = .talk
  var voiceConfig = VoiceAgentConfig()
  var voicePreview: VoiceAgentPreview?
  var voiceEntries: [VoiceAgentEntry] = []
  var voiceMessage: String?

  var modifyPlan: ModifyPlan?
  var modifySelected: Set<String> = []
  /** Which modify-mode task the browser is running, since both go through the upload stages. */
  var modifyTask: ModifyTask?
  var modifyDone: Set<String> = []
  var modifyActive: String?
  var modifyMessage: String?

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

  var isModify: Bool { config.mode == "modify" }
  var isVoiceAgent: Bool { product == .voiceAgent }
  var steps: [Step] { isVoiceAgent ? Step.voiceAgent : isModify ? Step.modifying : Step.create }
  var comparing: Bool { modifyTask == .compare && isRunning }
  var modifying: Bool { modifyTask == .modify && isRunning }
  var voiceUploading: Bool { isVoiceAgent && isRunning }

  /** Ticked items that can actually be changed, in the order the engine works through them. */
  var selectedItems: [ModifyItem] {
    (modifyPlan?.items ?? []).filter { modifySelected.contains($0.id) && $0.selectable }
  }

  var canRun: Bool {
    if isVoiceAgent { return !voiceConfig.packPath.isEmpty }
    return !config.workbookPath.isEmpty && !config.audioDir.isEmpty
      && !config.talkName.isEmpty && config.talkName.count < 20
      && (isModify || (!config.categoryName.isEmpty && config.categoryName.count < 10))
  }

  var canStart: Bool {
    if isVoiceAgent {
      let name = voicePreview?.pack?.agent.name.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      return canRun && voicePreview?.canUpload == true && !name.isEmpty && name.count <= 20
    }
    return canRun && summary?.canUpload == true
  }
  var pendingMatches: Int { summary?.canUpload == true ? summary?.audioMatch.reviewCount ?? 0 : 0 }

  var checkupCounts: (total: Int, fixable: Int, hints: Int) {
    let all = summary?.checkup.findings ?? []
    let findings = all.filter { !$0.isQaFlag && !$0.isPhraseCount }
    let fixable = findings.filter { !$0.options.isEmpty }.count
    return (all.count, fixable, findings.count - fixable)
  }

  var phraseCounts: (few: Int, some: Int) {
    let findings = summary?.checkup.findings ?? []
    return (findings.filter { $0.kind == "few-phrases" }.count, findings.filter { $0.kind == "some-phrases" }.count)
  }

  var qaCounts: (special: Int, invalid: Int, warnings: Int) {
    let findings = summary?.checkup.findings ?? []
    let count = { (kind: String) in findings.filter { $0.kind == kind }.count }
    return (count("special-qa"), count("invalid-qa"), count("special-question"))
  }

  func openCheckup(_ tab: String? = nil) {
    checkupTab = tab
    checkupOpen = true
  }

  var subtitle: String {
    if isVoiceAgent {
      return voiceConfig.packPath.isEmpty ? "未导入" : URL(fileURLWithPath: voiceConfig.packPath).lastPathComponent
    }
    return config.workbookPath.isEmpty ? "未导入" : URL(fileURLWithPath: config.workbookPath).lastPathComponent
  }

  func status(of step: Step) -> String {
    switch step {
    case .importFiles:
      if isVoiceAgent { return voiceConfig.packPath.isEmpty ? "" : "已添加" }
      return !config.workbookPath.isEmpty && !config.audioDir.isEmpty ? "已添加" : ""
    case .packReview:
      if checking { return "核对中" }
      guard let voicePreview else { return "" }
      return voicePreview.canUpload ? "已通过" : "\(voicePreview.errorCount) 处不合格"
    case .checkup:
      if checking { return "检查中" }
      guard let summary else { return "" }
      if !summary.canUpload { return "\(summary.errorCount) 个错误" }
      return pendingMatches > 0 ? "\(pendingMatches) 条待确认" : "已通过"
    case .intent:
      if intentLoading { return "分析中" }
      if let scheduledIntents { return "\(scheduledIntents.count) 条" }
      return ""
    case .upload:
      if isVoiceAgent { return voiceUploading ? stage.title : stage == .completed ? "已完成" : "" }
      return uploading ? stage.title : stage == .completed ? "已完成" : ""
    case .compare:
      if comparing { return "对比中" }
      return modifyPlan == nil ? "" : "\(selectedItems.count) 处"
    case .modify:
      if modifying { return "\(modifyDone.count)/\(selectedItems.count)" }
      return stage == .completed && modifyMessage != nil ? "已完成" : ""
    }
  }

  // MARK: Actions

  func update(_ change: (inout UploadConfig) -> Void) {
    let before = config
    change(&config)
    if before.workbookPath != config.workbookPath || before.audioDir != config.audioDir {
      summary = nil
      stage = .idle
      resetIntent()
      coachSkipped = []
    }
    if before.workbookPath != config.workbookPath || before.audioDir != config.audioDir || before.talkName != config.talkName || before.mode != config.mode {
      modifyPlan = nil
      modifySelected = []
      modifyMessage = nil
    }
    if before.workbookPath != config.workbookPath || before.audioDir != config.audioDir || before.categoryName != config.categoryName {
      Task { await refreshCheckpoint() }
    }
    if [.error, .cancelled, .completed].contains(stage) { stage = .idle }
    error = nil
  }

  func setProduct(_ product: Product) {
    guard !busy, self.product != product else { return }
    withAnimation(.smooth(duration: 0.45)) {
      self.product = product
      step = .importFiles
      stage = .idle
      error = nil
      logs = []
    }
  }

  func choosePack() {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = true
    panel.allowsMultipleSelection = false
    panel.allowedContentTypes = [.zip, .folder]
    panel.message = "选取语音 Agent 交付包（文件夹或 zip）"
    if panel.runModal() == .OK, let url = panel.url { setPack(url.path) }
  }

  func setPack(_ path: String) {
    voiceConfig.packPath = path
    voiceConfig.agent = nil
    voicePreview = nil
    voiceMessage = nil
    voiceEntries = []
    stage = .idle
    error = nil
    step = .importFiles
  }

  func updateVoiceAgent(_ mutate: (inout VoiceAgentFields) -> Void) {
    guard var preview = voicePreview, var pack = preview.pack else { return }
    mutate(&pack.agent)
    if !pack.agent.companyName.isEmpty { pack.companyName = pack.agent.companyName }
    preview.pack = pack
    voicePreview = preview
    voiceConfig.agent = pack.agent
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
    if isVoiceAgent {
      for url in urls {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else { continue }
        if isDirectory.boolValue || url.pathExtension.lowercased() == "zip" {
          setPack(url.path)
          return true
        }
      }
      error = AppErrorInfo(code: "E-DROP-004", message: "无法识别拖入的内容。", suggestion: "请拖入 skill 交付包文件夹，或 .zip。")
      step = .importFiles
      return false
    }
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
        await refreshCheckpoint()
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

  func saveVoiceSample() async {
    await saveFile("voice-agent:save-sample", success: "示例交付包已保存")
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
    if isVoiceAgent { return voicePrimaryAction() }
    switch step {
    case .importFiles:
      return (checking ? "检查中…" : "检查数据", canRun && !busy, { Task { await self.runCheck() } })
    case .checkup:
      guard let summary else { return ("检查数据", canRun && !busy, { Task { await self.runCheck() } }) }
      if pendingMatches > 0 { return ("确认录音（\(pendingMatches)）", !busy, { self.matchMode = .review }) }
      if !summary.canUpload { return ("重新检查", canRun && !busy, { Task { await self.runCheck() } }) }
      if isModify { return ("下一步：对比", !busy, { self.step = .compare }) }
      return ("下一步：意向", !busy, { self.step = .intent })
    case .compare:
      if comparing { return ("停止", true, { Task { await self.cancelUpload() } }) }
      if modifyPlan == nil { return ("开始对比", canStart && pendingMatches == 0 && !busy, { Task { await self.startCompare() } }) }
      return ("下一步：修改", !selectedItems.isEmpty && !busy, { self.step = .modify })
    case .modify:
      if modifying { return ("停止", stage != .review, { Task { await self.cancelUpload() } }) }
      if stage == .completed, modifyMessage != nil {
        return ("再对比一次", canStart && !busy, { self.step = .compare; Task { await self.startCompare() } })
      }
      return ("开始修改", !selectedItems.isEmpty && !busy, { Task { await self.startModify() } })
    case .intent:
      return ("下一步：上传", canStart && !busy, { self.step = .upload })
    case .upload:
      if uploading { return ("停止", stage != .review, { Task { await self.cancelUpload() } }) }
      if checkpoint != nil { return ("接着传", canStart && !busy, { Task { await self.startUpload(resume: true) } }) }
      return (stage == .completed ? "再传一次" : "开始上传", canStart && !busy, { Task { await self.startUpload() } })
    case .packReview:
      return ("核对交付包", canRun && !busy, { Task { await self.previewVoice() } })
    }
  }

  private func voicePrimaryAction() -> (label: String, enabled: Bool, run: () -> Void) {
    switch step {
    case .importFiles:
      return (checking ? "核对中…" : "核对交付包", canRun && !busy, { Task { await self.previewVoice() } })
    case .packReview:
      guard let voicePreview else { return ("核对交付包", canRun && !busy, { Task { await self.previewVoice() } }) }
      if !voicePreview.canUpload { return ("重新核对", canRun && !busy, { Task { await self.previewVoice() } }) }
      return ("下一步：上传", !busy, { self.step = .upload })
    default:
      if voiceUploading {
        if stage == .login { return ("已登录，继续", true, { self.confirmLogin() }) }
        if stage == .paste { return ("粘贴好了，继续", true, { Task { await self.confirmVoicePaste() } }) }
        return ("停止", true, { Task { await self.cancelUpload() } })
      }
      return (stage == .completed ? "再传一次" : "开始上传", canStart && !busy, { Task { await self.startVoiceUpload() } })
    }
  }

  func previewVoice() async {
    error = nil
    checking = true
    defer { checking = false }
    do {
      let result: ServiceResult<VoicePreviewPayload> = try await sidecar.call("voice-agent:preview", voiceConfig)
      if let preview = result.payload?.preview {
        voicePreview = preview
        voiceConfig.agent = preview.pack?.agent
        step = .packReview
        return
      }
      error = result.error
      stage = .error
    } catch {
      self.error = .bridge(error)
      stage = .error
    }
  }

  func startVoiceUpload() async {
    guard canStart, !busy else { return }
    error = nil
    logs = []
    progress = (nil, nil)
    voiceEntries = []
    voiceMessage = nil
    stage = .launching
    do {
      let result: UploadResult = try await sidecar.call("voice-agent:start", voiceConfig)
      voiceMessage = result.message
      switch result.status {
      case "completed": stage = .completed
      case "cancelled": stage = .cancelled
      default:
        stage = .error
        error = result.error ?? AppErrorInfo(code: "E-UNKNOWN-001", message: result.message ?? "上传没有完成。", suggestion: "请核对交付包后再试。")
      }
    } catch {
      self.error = .bridge(error)
      stage = .error
    }
  }

  func pickVoiceEntry(_ index: Int) {
    Task { _ = try? await sidecar.call("voice-agent:pick-entry", index, as: Bool.self) }
  }

  func copyVoicePrompt() {
    guard let json = voicePreview?.pack?.promptJson, !json.isEmpty else { return }
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(json, forType: .string)
    notice = "后台提示词已复制"
  }

  func confirmVoicePaste() async {
    copyVoicePrompt()
    _ = try? await sidecar.call("voice-agent:confirm-paste", as: Bool.self)
  }

  // MARK: Intent

  func resetIntent() {
    if intentLoading { Task { _ = try? await sidecar.call("ai:cancel", as: Ignored?.self) } }
    intentAnalysis = nil
    intentQuestions = []
    intentResult = nil
    intentError = nil
    intentLoading = false
    scheduledIntents = nil
  }

  func analyzeIntents() async {
    guard !intentLoading else { return }
    intentLoading = true
    intentError = nil
    intentProgress = nil
    sidecar.onAiProgress = { [weak self] progress in self?.intentProgress = progress }
    defer { intentLoading = false; sidecar.onAiProgress = nil }
    do {
      let result: ServiceResult<AnalysisPayload> = try await sidecar.call("intent:analyze", config)
      guard let analysis = result.payload?.analysis else {
        if result.status != "cancelled" { intentError = result.error }
        return
      }
      intentAnalysis = analysis
      intentQuestions = analysis.questions
      await replanIntents()
    } catch {
      intentError = .bridge(error)
    }
  }

  func moveQuestion(_ name: String, to signal: String) {
    guard let index = intentQuestions.firstIndex(where: { $0.name == name }), intentQuestions[index].signal != signal else { return }
    intentQuestions[index].signal = signal
    intentQuestions[index].source = "user"
    intentQuestions[index].alternative = nil
    Task { await replanIntents() }
  }

  private func replanIntents() async {
    guard let intentAnalysis else { return }
    do {
      intentResult = try await sidecar.call("intent:plan", intentAnalysis, intentQuestions)
    } catch {
      intentError = .bridge(error)
    }
  }

  func exportIntents() async {
    guard let markdown = intentResult?.markdown else { return }
    do {
      let result: ServiceResult<NoPayload> = try await sidecar.call("intent:export", config, markdown)
      if result.status == "saved", let path = result.path {
        notice = "意向建议已导出：\(URL(fileURLWithPath: path).lastPathComponent)"
      } else if let failure = result.error {
        error = failure
      }
    } catch {
      self.error = .bridge(error)
    }
  }

  func copyIntents() {
    guard let markdown = intentResult?.markdown else { return }
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(markdown, forType: .string)
    notice = "意向建议已复制"
  }

  // MARK: Upload

  func startUpload(resume: Bool = false) async {
    guard canStart, !busy else { return }
    error = nil
    logs = []
    progress = (nil, nil)
    uploadActive = nil
    uploadMessage = nil
    stage = .launching
    if resume, let checkpoint {
      config.talkName = checkpoint.talkName
      uploadDone = Set(checkpoint.doneAudioNumbers)
    } else {
      uploadDone = []
      if checkpoint != nil { _ = try? await sidecar.call("automation:discard-checkpoint", config, as: Ignored?.self) }
    }
    checkpoint = nil
    defer { Task { await refreshCheckpoint() } }
    do {
      let result: UploadResult = try await sidecar.call("automation:start", config, scheduledIntents ?? [], StartOptions(resume: resume))
      uploadMessage = result.message
      uploadActive = nil
      switch result.status {
      case "completed": stage = .completed
      case "cancelled": stage = .cancelled
      default:
        stage = .error
        error = result.error ?? AppErrorInfo(code: "E-UNKNOWN-001", message: result.message ?? "上传没有完成。", suggestion: "请重新检查数据后再试。")
      }
    } catch {
      self.error = .bridge(error)
      stage = .error
    }
  }

  func confirmLogin() {
    Task { _ = try? await sidecar.call("automation:confirm-login", as: Ignored?.self) }
  }

  func cancelUpload() async {
    _ = try? await sidecar.call("automation:cancel", as: Ignored?.self)
  }

  var renameValid: Bool {
    let name = renameDraft.trimmingCharacters(in: .whitespaces)
    return !name.isEmpty && name.count < 20 && name != config.talkName
  }

  func submitRename() {
    guard renameValid else { return }
    let name = renameDraft.trimmingCharacters(in: .whitespaces)
    Task {
      if (try? await sidecar.call("automation:rename", name, as: Bool.self)) == true { config.talkName = name }
    }
  }

  func useExistingTalk() {
    Task { _ = try? await sidecar.call("automation:use-existing", as: Bool.self) }
  }

  func refreshCheckpoint() async {
    guard saved == nil, !isModify, !isRunning, !config.workbookPath.isEmpty, !config.audioDir.isEmpty else {
      if !isRunning { checkpoint = nil }
      return
    }
    checkpoint = try? await sidecar.call("automation:checkpoint", config, as: UploadCheckpointInfo?.self) ?? nil
  }

  private func trackUpload(_ event: ProgressEvent) {
    guard let summary else { return }
    let sections = summary.sections
    switch stage {
    case .flow: mark(sections.flow, event)
    case .vague: mark(sections.vague, event)
    case .knowledge: mark(sections.knowledge.filter { $0.fileName != nil }, event)
    case .intent, .review, .completed:
      uploadDone.formUnion(summary.audioMatch.items.map(\.audioNumber))
      uploadActive = nil
    default: break
    }
  }

  private func mark(_ items: [AudioMatchItem], _ event: ProgressEvent) {
    guard let current = event.current, current >= 1, current <= items.count else { return }
    let finished = ["已确认上传", "跳过录音", "已保存", "已完成"].contains { event.message.contains($0) }
    uploadDone.formUnion(items.prefix(finished ? current : current - 1).map(\.audioNumber))
    uploadActive = finished ? nil : items[current - 1].audioNumber
  }

  // MARK: Modify

  /// Switches between creating a talk and editing an existing one. Files and the name stay; the check reruns
  /// because modify mode matches recordings by what they say.
  func setMode(_ mode: String) {
    guard !busy else { return }
    let fromVoice = isVoiceAgent
    product = .talk
    guard fromVoice || config.mode != mode else { return }
    withAnimation(.smooth(duration: 0.45)) {
      update { $0.mode = mode }
      summary = nil
      stage = .idle
      step = .importFiles
      error = nil
    }
  }

  /// From the name clash during an upload: stop it and edit the talk that already has this name.
  func modifyExistingTalk() async {
    _ = try? await sidecar.call("automation:modify-existing", as: Bool.self)
    for _ in 0..<100 where isRunning { try? await Task.sleep(for: .milliseconds(100)) }
    setMode("modify")
    if let summary = await preview() {
      step = summary.canUpload && summary.audioMatch.reviewCount == 0 ? .compare : .checkup
    }
  }

  func startCompare() async {
    guard canStart, !busy else { return }
    error = nil
    logs = []
    progress = (nil, nil)
    modifyPlan = nil
    modifySelected = []
    modifyMessage = nil
    modifyTask = .compare
    stage = .launching
    defer { modifyTask = nil }
    do {
      let result: ModifyCompareResult = try await sidecar.call("modify:compare", config)
      if let plan = result.plan, result.ok {
        modifyPlan = plan
        modifySelected = Set(plan.items.filter(\.selected).map(\.id))
        stage = .ready
      } else if stage != .cancelled, error == nil {
        stage = .blocked
        error = AppErrorInfo(code: "E-MODIFY-002", message: result.message ?? "对比没有完成。", suggestion: "处理好后再点“开始对比”。")
      }
    } catch {
      self.error = .bridge(error)
      stage = .error
    }
  }

  func toggleModifyItem(_ id: String, _ on: Bool) {
    if on { modifySelected.insert(id) } else { modifySelected.remove(id) }
  }

  func startModify() async {
    let items = selectedItems
    guard !items.isEmpty, !busy else { return }
    error = nil
    logs = []
    progress = (nil, nil)
    modifyDone = []
    modifyActive = nil
    modifyMessage = nil
    modifyTask = .modify
    stage = .launching
    defer { modifyTask = nil }
    do {
      let result: UploadResult = try await sidecar.call("modify:apply", config, items.map(\.id))
      modifyMessage = result.message
      modifyActive = nil
      switch result.status {
      case "completed": stage = .completed
      case "cancelled": stage = .cancelled
      default:
        stage = .error
        error = result.error ?? AppErrorInfo(code: "E-UNKNOWN-001", message: result.message ?? "修改没有完成。", suggestion: "重新对比后再试。")
      }
    } catch {
      self.error = .bridge(error)
      stage = .error
    }
  }

  private func trackModify(_ event: ProgressEvent) {
    let items = selectedItems
    if event.stage == "completed" {
      modifyDone = Set(items.map(\.id))
      modifyActive = nil
      return
    }
    guard ["flow", "vague", "knowledge"].contains(event.stage), let current = event.current, current >= 1, current <= items.count else { return }
    let item = items[current - 1]
    if event.message.contains("已改好") || event.message.contains("跳过") {
      modifyDone.insert(item.id)
      modifyActive = nil
    } else {
      modifyActive = item.id
    }
  }

  private func received(_ event: ProgressEvent) {
    let next = Stage(rawValue: event.stage) ?? .idle
    if next == .rename, stage != .rename { renameDraft = String("\(config.talkName)-2".prefix(19)) }
    if next == .entry {
      Task {
        try? await Task.sleep(for: .milliseconds(200))
        voiceEntries = (try? await sidecar.call("voice-agent:entries", as: [VoiceAgentEntry].self)) ?? []
      }
    }
    if next == .paste { copyVoicePrompt() }
    stage = next
    switch modifyTask {
    case .modify: trackModify(event)
    case .compare: break
    case nil: trackUpload(event)
    }
    progress = (event.current, event.total)
    logs = Array((logs + [event]).suffix(200))
    if stage == .error { error = event.error ?? AppErrorInfo(code: "E-UNKNOWN-001", message: event.message, suggestion: "请重新检查数据后再试。") }
    if stage == .completed { error = nil }
  }
}
