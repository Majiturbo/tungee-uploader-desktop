import Foundation

/// Fictional data shown during the guided tour. Contains no real company or person names.
enum Demo {
  static let config = UploadConfig(talkName: "示例话术", workbookPath: "/示例/示例话术.xlsx", audioDir: "/示例/示例录音", categoryName: "客户问答")

  private static let flowLabels = ["开场白1", "开场白2", "产品介绍1", "产品介绍2", "产品介绍3", "客户邀约1", "客户邀约2", "结束话语1"]
  private static let vagueLabels = ["含糊话术1", "含糊话术2", "含糊话术3"]
  private static let knowledgeLabels = ["加个微信", "发份资料", "价格多少", "公司在哪", "做什么业务", "有什么优势", "太贵了", "已经有合作的了", "你是谁", "怎么称呼", "在忙", "不需要"]
  private static let missingNumber = 17
  /// Recordings in the demo with long silence at the ends: head and tail seconds cut.
  private static let trims: [Int: (head: Double, tail: Double)] = [5: (1.2, 3), 12: (0, 2.4)]

  private static func wave(duration: Double, head: Double, tail: Double) -> [Double] {
    (0..<48).map { index in
      let at = (Double(index) + 0.5) / 48 * duration
      if at < head + 0.2 || at > duration - tail - 0.3 { return 0.03 }
      return ((0.45 + 0.55 * abs(sin(Double(index) * 1.7))) * 100).rounded() / 100
    }
  }

  static let items: [AudioMatchItem] = (flowLabels + vagueLabels + knowledgeLabels).enumerated().map { index, label in
    let number = index + 1
    return AudioMatchItem(
      audioNumber: number, label: label, speech: "", fileName: number == missingNumber ? nil : "\(number).wav",
      basis: "number", score: 1, needsReview: false, reason: nil, candidates: [],
      trim: trims[number].map { AudioTrimInfo(head: $0.head, tail: $0.tail, duration: 9, wave: wave(duration: 9, head: $0.head, tail: $0.tail)) }
    )
  }

  static let summary = PreviewSummary(
    detectedSheetName: "话术内容",
    canUpload: true,
    errorCount: 0,
    warningCount: 1,
    flowCount: flowLabels.count,
    vagueCount: vagueLabels.count,
    knowledgeCount: knowledgeLabels.count,
    flowAudioCount: flowLabels.count,
    vagueAudioCount: vagueLabels.count,
    knowledgeAudioCount: knowledgeLabels.count - 1,
    plannedUploadCount: items.count - 1,
    convertAudioNumbers: [3, 7],
    trimAudioNumbers: trims.keys.sorted(),
    invalidQaCount: 0,
    specialQaCount: 2,
    bothQaCount: 0,
    issues: [ValidationIssue(code: "W-AUDIO-001", severity: "warning", message: "缺少编号为 \(missingNumber) 的录音文件。", suggestion: "补上录音后重新检查。")],
    checkup: CheckupResult(findings: [
      CheckupFinding(id: "demo-filler", kind: "filler-phrase", title: "加个微信", message: "1 条问法带语气词。",
                     examples: ["「嗯，加个微信吧」 → 「加个微信吧」"], rowNumbers: [12], options: [CheckupOption(id: "fix", label: "去掉语气词")], defaultOption: "fix"),
      CheckupFinding(id: "demo-duplicate", kind: "duplicate-phrase", title: "价格多少", message: "2 条问法重复出现，删除后不影响识别。",
                     examples: ["「多少钱」", "「怎么收费」"], rowNumbers: [14], options: [CheckupOption(id: "fix", label: "删除重复项")], defaultOption: "fix"),
      CheckupFinding(id: "demo-few", kind: "few-phrases", title: "公司在哪", message: "只有 3 条问法，建议补充到 6 条以上。",
                     examples: ["「公司在哪」", "「地址在哪」", "「在哪个城市」"], rowNumbers: [16], options: [], defaultOption: nil),
    ]),
    audioMatch: AudioMatchSummary(
      audioDir: config.audioDir, items: items, files: items.compactMap { $0.fileName.map { AudioMatchFile(name: $0) } },
      unusedFiles: [], smart: true, autoCount: items.count - 1, reviewCount: 0, speechUnavailable: nil
    )
  )

  private static let signals: [String: String] = [
    "加个微信": "action", "发份资料": "action", "价格多少": "price", "公司在哪": "consult", "做什么业务": "consult",
    "有什么优势": "consult", "太贵了": "objection", "已经有合作的了": "objection", "你是谁": "other", "怎么称呼": "other",
    "在忙": "reject", "不需要": "reject",
  ]

  static let questions: [IntentQuestion] = knowledgeLabels.map {
    IntentQuestion(name: $0, phrases: [$0], signal: signals[$0] ?? "other", source: "model", alternative: $0 == "有什么优势" ? "action" : nil)
  }

  static let analysis = IntentAnalysis(flowCount: flowLabels.count, vagueCount: vagueLabels.count, knowledgeCount: knowledgeLabels.count,
                                       questions: questions, modelUsed: true, modelUnavailable: nil)

  private static let cards = [
    IntentCard(id: "action", level: "A级", description: "要微信/资料", when: "客户想加微信或要资料，愿意进一步了解。", match: "任意", order: "", confirms: [], questions: ["加个微信", "发份资料"]),
    IntentCard(id: "price", level: "A级", description: "主动询价", when: "客户主动问价格。", match: "任意", order: "", confirms: [], questions: ["价格多少"]),
    IntentCard(id: "consult", level: "B级", description: "业务咨询", when: "客户在了解公司和业务。", match: "任意", order: "",
               confirms: ["「有什么优势」也可能是明确行动，确认一下放在哪里。"], questions: ["公司在哪", "做什么业务", "有什么优势"]),
    IntentCard(id: "objection", level: "C级", description: "嫌贵/已有合作", when: "客户有顾虑，暂时不需要。", match: "任意", order: "", confirms: [], questions: ["太贵了", "已经有合作的了"]),
  ]

  static let plan = IntentPlanResult(
    plan: IntentPlan(cards: cards, skipped: [
      IntentSkipped(name: "你是谁", reason: "身份确认，不代表意向"),
      IntentSkipped(name: "怎么称呼", reason: "身份确认，不代表意向"),
      IntentSkipped(name: "在忙", reason: "明确拒绝，交给默认意向"),
      IntentSkipped(name: "不需要", reason: "明确拒绝，交给默认意向"),
    ], confirms: []),
    setups: cards.map { IntentSetup(level: $0.level, description: $0.description, match: $0.match, questions: $0.questions,
                                    placement: $0.level == "C级" ? "end" : "before-main-affirm") },
    markdown: "# 示例话术 · 意向设置建议\n",
    flagged: ["有什么优势"]
  )

  private static func change(_ id: String, _ kind: String, _ label: String, status: String = "changed", text: Bool = false, phrases: Bool = false,
                             audio: String? = nil, from: String? = nil, to: String? = nil, added: [String] = [], removed: [String] = [],
                             warnings: [String] = []) -> ModifyItem {
    ModifyItem(id: id, kind: kind, label: label, status: status, textChanged: text, phrasesChanged: phrases, audioFile: audio,
               onlineText: from, newText: to, addedPhrases: added, removedPhrases: removed, warnings: warnings,
               selected: status == "changed" || status == "new")
  }

  /// A comparison result for rendering the modify pages without reading any real talk.
  static let modifyPlan = ModifyPlan(
    talkName: "示例话术",
    readAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-120)),
    backupPath: "/tmp/tungee-demo/modify-backups/示例话术-0929-1430.json",
    items: [
      change("flow-开场白-0", "flow", "开场白1", text: true, audio: "开场白新版.m4a",
             from: "您好，我是示例科技的客服，耽误您一分钟时间", to: "您好，这里是示例科技，想跟您简单介绍一下新服务",
             warnings: ["录音念的像「您好这里是示例科技想跟您介绍」，和表格文字不太一样"]),
      change("q-价格怎么算", "knowledge", "价格怎么算", text: true, phrases: true, audio: "价格.m4a",
             from: "按年收费，具体看套餐", to: "按年收费，基础版每年三千元，可以先试用", added: ["一年多少钱", "收费标准"]),
      change("flow-产品介绍-1", "flow", "产品介绍2", audio: "3.wav"),
      change("flow-结束话语-0", "flow", "结束话语1", audio: "结束语.m4a"),
      change("vague-0", "vague", "含糊话术1", text: true, from: "不好意思，刚才没听清", to: "不好意思，信号不太好，您能再说一遍吗"),
      change("q-有没有试用", "knowledge", "有没有试用", phrases: true, added: ["能先用用看吗", "可以免费体验吗"], removed: ["试"]),
      change("q-支持开发票吗", "knowledge", "支持开发票吗", status: "new", audio: "开票.m4a", to: "支持的，付款后可以开增值税普通发票或专用发票"),
      change("q-公司在哪里", "knowledge", "公司在哪里", status: "online-only"),
      change("q-怎么联系客服", "knowledge", "怎么联系客服", status: "online-only"),
      change("q-怎么注册", "knowledge", "怎么注册", status: "same"),
    ],
    unusedFiles: ["备用录音.m4a"]
  )

  static func logs(_ messages: [String], stage: String) -> [ProgressEvent] {
    let now = Date()
    return messages.enumerated().map { index, message in
      ProgressEvent(stage: stage, message: message,
                    timestamp: ISO8601DateFormatter().string(from: now.addingTimeInterval(Double(index - messages.count) * 3)))
    }
  }
}

/// Everything the tour replaces, so the real session comes back untouched afterwards.
struct SessionSnapshot {
  var config: UploadConfig
  var summary: PreviewSummary?
  var step: Step
  var stage: Stage
  var progress: (current: Int?, total: Int?)
  var logs: [ProgressEvent]
  var error: AppErrorInfo?
  var showInspector: Bool
  var intentAnalysis: IntentAnalysis?
  var intentQuestions: [IntentQuestion]
  var intentResult: IntentPlanResult?
  var scheduledIntents: [IntentSetup]?
  var uploadDone: Set<Int>
  var uploadActive: Int?
  var uploadMessage: String?
  var checkpoint: UploadCheckpointInfo?
}

extension AppModel {
  func enterDemo() {
    saved = SessionSnapshot(
      config: config, summary: summary, step: step, stage: stage, progress: progress, logs: logs, error: error,
      showInspector: showInspector, intentAnalysis: intentAnalysis, intentQuestions: intentQuestions, intentResult: intentResult,
      scheduledIntents: scheduledIntents, uploadDone: uploadDone, uploadActive: uploadActive, uploadMessage: uploadMessage,
      checkpoint: checkpoint
    )
    checkpoint = nil
    config = Demo.config
    summary = Demo.summary
    error = nil
    notice = nil
    showInspector = true
    intentAnalysis = Demo.analysis
    intentQuestions = Demo.questions
    intentResult = Demo.plan
    scheduledIntents = nil
  }

  func exitDemo() {
    guard let saved else { return }
    config = saved.config
    summary = saved.summary
    step = saved.step
    stage = saved.stage
    progress = saved.progress
    logs = saved.logs
    error = saved.error
    showInspector = saved.showInspector
    intentAnalysis = saved.intentAnalysis
    intentQuestions = saved.intentQuestions
    intentResult = saved.intentResult
    scheduledIntents = saved.scheduledIntents
    uploadDone = saved.uploadDone
    uploadActive = saved.uploadActive
    uploadMessage = saved.uploadMessage
    checkpoint = saved.checkpoint
    notice = nil
    self.saved = nil
  }

  /// Moves the fake upload one recording forward, looping so the tour always has something lighting up.
  func advanceDemoUpload() {
    let sorted = Demo.items.sorted { $0.audioNumber < $1.audioNumber }
    guard let active = uploadActive, let position = sorted.firstIndex(where: { $0.audioNumber == active }) else { return }
    uploadDone.insert(active)
    if position + 1 < sorted.count {
      uploadActive = sorted[position + 1].audioNumber
      progress = (max(1, position + 2 - Demo.summary.flowCount - Demo.summary.vagueCount), Demo.summary.knowledgeCount - 1)
      logs = Array((logs + Demo.logs(["正在新增知识库：\(sorted[position + 1].label)"], stage: "knowledge")).suffix(8))
    } else {
      uploadDone = Set(sorted.prefix(8).map(\.audioNumber))
      uploadActive = sorted[8].audioNumber
    }
  }

  /// Puts the demo session into the state a tour step talks about.
  func showDemo(_ scene: TourScene, on page: Step) {
    step = page
    uploadMessage = nil
    switch scene {
    case .idle:
      stage = .idle
      progress = (nil, nil)
      logs = []
      uploadDone = []
      uploadActive = nil
      scheduledIntents = nil
    case .scheduled:
      stage = .idle
      logs = []
      uploadDone = []
      uploadActive = nil
      scheduledIntents = Demo.plan.setups
    case .login:
      stage = .login
      progress = (nil, nil)
      uploadDone = []
      uploadActive = nil
      scheduledIntents = Demo.plan.setups
      logs = Demo.logs(["2 个录音已转成 8k 单声道 WAV", "正在打开 Chrome", "等待登录探迹"], stage: "login")
    case .running:
      let sorted = Demo.items.sorted { $0.audioNumber < $1.audioNumber }
      stage = .knowledge
      progress = (5, Demo.summary.knowledgeCount - 1)
      scheduledIntents = Demo.plan.setups
      uploadDone = Set(sorted.prefix(15).map(\.audioNumber))
      uploadActive = sorted[15].audioNumber
      logs = Demo.logs(["已登录探迹", "主流程 8 条已确认上传", "含糊话术 3 条已确认上传", "正在新增知识库：做什么业务"], stage: "knowledge")
    }
  }
}
