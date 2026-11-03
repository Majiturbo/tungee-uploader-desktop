import Foundation

// Mirrors src/shared/types.ts. Only fields the Mac UI reads are declared.

struct UploadConfig: Codable, Equatable {
  var talkName = ""
  var workbookPath = ""
  var audioDir = ""
  var categoryName = "客户问答"
  var submitReview = false
  /** "create" uploads a new talk; "modify" edits the talk online that has this name. */
  var mode = "create"
}

struct VoiceAgentConfig: Codable, Equatable {
  var packPath = ""
  var agent: VoiceAgentFields?
}

struct VoiceAgentFields: Codable, Hashable {
  var name = ""
  var companyName = ""
  var selfName = ""
  var role = ""
  var customRole = ""
  var scene = ""
  var goal = ""
  var greeting = ""
  var opening = ""
  var companyInfo = ""
}

struct VoiceKnowledgeFile: Codable, Hashable, Identifiable {
  var name: String
  var path: String
  var id: String { path }
}

struct VoiceAgentPack: Codable, Hashable {
  var rootDir: String
  var companyName: String
  var agent: VoiceAgentFields
  var knowledgeFiles: [VoiceKnowledgeFile]
  var hotwordCount: Int
  var hotwordsPreview: [String]
  var intentUpdates: [String]
  var intentCreates: [String]
  var promptJson: String
  var confirmCard: String
}

struct VoiceAgentPreview: Codable, Hashable {
  var canUpload: Bool
  var errorCount: Int
  var warningCount: Int
  var issues: [ValidationIssue]
  var pack: VoiceAgentPack?
}

struct VoicePreviewPayload: Decodable { var preview: VoiceAgentPreview }

struct VoiceAgentEntry: Codable, Hashable, Identifiable {
  var index: Int
  var label: String
  var id: Int { index }
}

struct AppErrorInfo: Codable, Hashable, Error {
  var code: String
  var message: String
  var suggestion: String
  var detail: String?

  static func bridge(_ error: Error) -> AppErrorInfo {
    AppErrorInfo(
      code: "E-APP-001",
      message: "后台服务通信失败。",
      suggestion: "请关闭本工具后重新打开；若仍出现，请把技术详情发给维护人员。",
      detail: String(describing: error)
    )
  }
}

struct ValidationIssue: Codable, Hashable {
  var code: String
  var severity: String
  var message: String
  var suggestion: String
  var sheetName: String?
  var rowNumber: Int?
}

struct CheckupOption: Codable, Hashable, Identifiable {
  var id: String
  var label: String
}

struct CheckupFinding: Codable, Hashable, Identifiable {
  var id: String
  var kind: String
  var title: String
  var message: String
  var examples: [String]
  var rowNumbers: [Int]
  var options: [CheckupOption]
  var defaultOption: String?

  var isAutoFix: Bool { !options.isEmpty && defaultOption != nil }
  /** 特殊QA / 无效QA suggestions and warnings, shown in their own tab. */
  var isQaFlag: Bool { ["special-qa", "invalid-qa", "special-question"].contains(kind) }
  var isPhraseCount: Bool { kind == "few-phrases" || kind == "some-phrases" }
}

struct CheckupResult: Codable, Hashable {
  var findings: [CheckupFinding]
}

struct AudioMatchCandidate: Codable, Hashable {
  var fileName: String
  var score: Double
  var basis: String
}

struct AudioMatchItem: Codable, Hashable, Identifiable {
  var audioNumber: Int
  var label: String
  var speech: String
  var fileName: String?
  var basis: String
  var score: Double
  var needsReview: Bool
  var reason: String?
  var candidates: [AudioMatchCandidate]
  var trim: AudioTrimInfo?
  var id: Int { audioNumber }
}

struct AudioTrimInfo: Codable, Hashable {
  /** Seconds cut from the start and the end before uploading; 0 leaves that end alone. */
  var head: Double
  var tail: Double
  var duration: Double
  /** Peak level of each slice across the whole recording, 0–1. */
  var wave: [Double]

  /** "剪掉开头 1.2 秒、结尾 3.0 秒", or nil when the recording is uploaded whole. */
  var note: String? {
    let parts = [head > 0 ? "开头 \(String(format: "%.1f", head)) 秒" : nil, tail > 0 ? "结尾 \(String(format: "%.1f", tail)) 秒" : nil].compactMap { $0 }
    return parts.isEmpty ? nil : "剪掉\(parts.joined(separator: "、"))"
  }
}

struct AudioMatchFile: Codable, Hashable {
  var name: String
  var transcript: String?
}

struct AudioMatchSummary: Codable, Hashable {
  var audioDir: String
  var items: [AudioMatchItem]
  var files: [AudioMatchFile]
  var unusedFiles: [String]
  var smart: Bool
  var autoCount: Int
  var reviewCount: Int
  var speechUnavailable: String?
}

struct PreviewSummary: Codable, Hashable {
  var detectedSheetName: String
  var canUpload: Bool
  var errorCount: Int
  var warningCount: Int
  var flowCount: Int
  var vagueCount: Int
  var knowledgeCount: Int
  var flowAudioCount: Int
  var vagueAudioCount: Int
  var knowledgeAudioCount: Int
  var plannedUploadCount: Int
  var convertAudioNumbers: [Int]
  /// Recordings whose silence at either end is cut before uploading.
  var trimAudioNumbers: [Int]
  var invalidQaCount: Int
  var specialQaCount: Int
  var bothQaCount: Int
  var issues: [ValidationIssue]
  var checkup: CheckupResult
  var audioMatch: AudioMatchSummary
}

struct ProgressEvent: Codable, Hashable {
  var stage: String
  var message: String
  var current: Int?
  var total: Int?
  var timestamp: String
  var error: AppErrorInfo?
}

struct AiProgress: Codable {
  var current: Int
  var total: Int
}

/// Every service result is a `{ status, ... }` union; unused members stay nil.
struct ServiceResult<Payload: Decodable>: Decodable {
  var status: String
  var error: AppErrorInfo?
  var path: String?
  var payload: Payload?

  private enum Keys: String, CodingKey { case status, error, path }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: Keys.self)
    status = try container.decode(String.self, forKey: .status)
    error = try container.decodeIfPresent(AppErrorInfo.self, forKey: .error)
    path = try container.decodeIfPresent(String.self, forKey: .path)
    payload = try? Payload(from: decoder)
  }
}

struct SummaryPayload: Decodable { var summary: PreviewSummary }
struct FindingsPayload: Decodable { var findings: [CheckupFinding] }
struct PhrasesPayload: Decodable { var phrases: [String] }
struct NoPayload: Decodable {}

struct UploadCheckpointInfo: Decodable, Equatable {
  var talkName: String
  var doneAudioNumbers: [Int]
  var updatedAt: String
}

struct StartOptions: Encodable {
  var resume: Bool
}

struct UploadResult: Decodable {
  var status: String
  var message: String?
  var error: AppErrorInfo?
}

// MARK: Modify

struct ModifyItem: Decodable, Hashable, Identifiable {
  var id: String
  var kind: String
  var label: String
  var status: String
  var textChanged: Bool
  var phrasesChanged: Bool
  var audioFile: String?
  var onlineText: String?
  var newText: String?
  var addedPhrases: [String]
  var removedPhrases: [String]
  var warnings: [String]
  var selected: Bool
  var audioNumber: Int? = nil

  var selectable: Bool { status == "changed" || status == "new" }
}

struct ModifyPlan: Decodable, Hashable {
  var talkName: String
  var readAt: String
  var backupPath: String
  var items: [ModifyItem]
  var unusedFiles: [String]
}

struct ModifyCompareResult: Decodable {
  var ok: Bool
  var plan: ModifyPlan?
  var message: String?
}

enum Stage: String {
  case idle, reading, matching, ready, blocked, converting, launching, login, rename, comparing, flow, vague, knowledge, intent, review
  case entry, quota, creating, generating, personalize, attach, paste
  case completed, cancelled, error

  var title: String {
    switch self {
    case .idle: "等待开始"
    case .reading: "检查数据"
    case .matching: "识别录音"
    case .ready: "可以上传"
    case .blocked: "需要修正"
    case .converting: "转换录音"
    case .launching: "启动浏览器"
    case .login: "等待登录"
    case .rename: "需要换名字"
    case .comparing: "读取线上话术"
    case .flow: "主流程"
    case .vague: "含糊话术"
    case .knowledge: "知识库"
    case .intent: "意向设置"
    case .review: "提交审核"
    case .entry: "选择入口"
    case .quota: "核对额度"
    case .creating: "创建智能体"
    case .generating: "等待生成"
    case .personalize: "知识库与热词"
    case .attach: "编辑页挂载"
    case .paste: "复制后台提示词"
    case .completed: "已完成"
    case .cancelled: "已停止"
    case .error: "失败"
    }
  }

  var isRunning: Bool {
    [
      .reading, .matching, .converting, .launching, .login, .rename, .comparing,
      .flow, .vague, .knowledge, .intent, .review,
      .entry, .quota, .creating, .generating, .personalize, .attach, .paste,
    ].contains(self)
  }

  var isUpload: Bool {
    [
      .converting, .launching, .login, .rename, .flow, .vague, .knowledge, .intent, .review,
      .entry, .quota, .creating, .generating, .personalize, .attach, .paste,
      .completed, .cancelled, .error,
    ].contains(self)
  }
}

let checkupKindLabels: [String: String] = [
  "system-prompt": "系统提示更新",
  "filler-phrase": "语气词",
  "duplicate-phrase": "问法重复",
  "phrase-format": "符号异常",
  "shared-phrase": "两个问题抢同一句",
  "few-phrases": "问法太少",
  "some-phrases": "问法偏少",
  "special-qa": "建议设为特殊QA",
  "invalid-qa": "建议设为无效QA",
  "special-question": "特殊QA是问句",
  "long-speech": "话术偏长",
  "typo": "AI 查错字漏字",
]

let checkupKindNotes: [String: String] = [
  "filler-phrase": "探迹会把带语气词的问法当成另一句，上传时也会自动去掉。",
  "duplicate-phrase": "重复的问法删除后不影响识别。",
  "phrase-format": "多余符号，或两句粘成了一句。",
  "few-phrases": "不到 6 条，AI 写的已勾选。",
  "some-phrases": "6–9 条，AI 写的默认不勾，需要再勾。",
  "special-qa": "命中后立即挂断。回答以结束语收尾的，一般都该设。",
  "invalid-qa": "不计入意向。默认不勾，按你的业务判断。",
  "special-question": "命中后立即挂断，但话术在提问，客户来不及回答。去 Excel 里去掉特殊QA，或把结尾改成结束语。",
]

let matchBasisLabels: [String: String] = [
  "confirmed": "已确认",
  "number": "文件名编号",
  "name-number": "文件名含编号",
  "name": "文件名",
  "speech": "语音内容",
  "order": "录音顺序",
]

// MARK: Intent

struct IntentQuestion: Codable, Hashable, Identifiable {
  var name: String
  var phrases: [String]
  var signal: String
  var source: String
  var alternative: String?
  var id: String { name }
}

struct IntentAnalysis: Codable, Hashable {
  var flowCount: Int
  var vagueCount: Int
  var knowledgeCount: Int
  var questions: [IntentQuestion]
  var modelUsed: Bool
  var modelUnavailable: String?
}

struct IntentCard: Codable, Hashable, Identifiable {
  var id: String
  var level: String
  var description: String
  var when: String
  var match: String
  var order: String
  var confirms: [String]
  var questions: [String]
  var title: String { "\(level)｜\(description)" }
}

struct IntentSkipped: Codable, Hashable {
  var name: String
  var reason: String
}

struct IntentPlan: Codable, Hashable {
  var cards: [IntentCard]
  var skipped: [IntentSkipped]
  var confirms: [String]
}

struct IntentSetup: Codable, Hashable {
  var level: String
  var description: String
  var match: String
  var questions: [String]
  var placement: String
  var title: String { "\(level)｜\(description)" }
}

struct IntentPlanResult: Decodable {
  var plan: IntentPlan
  var setups: [IntentSetup]
  var markdown: String
  var flagged: [String]
}

struct AnalysisPayload: Decodable { var analysis: IntentAnalysis }

let intentMoveTargets: [(signal: String, label: String)] = [
  ("action", "A级｜明确行动"),
  ("price", "A级｜主动询价"),
  ("consult", "B级｜业务咨询"),
  ("objection", "C级｜暂缓或异议"),
  ("other", "不建意向"),
]
