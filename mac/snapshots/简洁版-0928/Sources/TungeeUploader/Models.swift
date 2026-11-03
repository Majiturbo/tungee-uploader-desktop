import Foundation

// Mirrors src/shared/types.ts. Only fields the Mac UI reads are declared.

struct UploadConfig: Codable, Equatable {
  var talkName = ""
  var workbookPath = ""
  var audioDir = ""
  var categoryName = "客户问答"
  var submitReview = false
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
  var id: Int { audioNumber }
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

enum Stage: String {
  case idle, reading, matching, ready, blocked, converting, launching, login, flow, vague, knowledge, intent, review, completed, cancelled, error

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
    case .flow: "主流程"
    case .vague: "含糊话术"
    case .knowledge: "知识库"
    case .intent: "意向设置"
    case .review: "提交审核"
    case .completed: "已完成"
    case .cancelled: "已停止"
    case .error: "失败"
    }
  }

  var isRunning: Bool {
    [.reading, .matching, .converting, .launching, .login, .flow, .vague, .knowledge, .intent, .review].contains(self)
  }

  var isUpload: Bool {
    [.converting, .launching, .login, .flow, .vague, .knowledge, .intent, .review, .completed, .cancelled, .error].contains(self)
  }
}

let checkupKindLabels: [String: String] = [
  "system-prompt": "系统提示更新",
  "filler-phrase": "语气词",
  "duplicate-phrase": "问法重复",
  "phrase-format": "符号异常",
  "shared-phrase": "两个问题抢同一句",
  "few-phrases": "问法太少",
  "long-speech": "话术偏长",
  "typo": "AI 查错字漏字",
]

let checkupKindNotes: [String: String] = [
  "filler-phrase": "探迹会把带语气词的问法当成另一句，上传时也会自动去掉。",
  "duplicate-phrase": "重复的问法删除后不影响识别。",
  "phrase-format": "多余符号，或两句粘成了一句。",
]

let matchBasisLabels: [String: String] = [
  "confirmed": "已确认",
  "number": "文件名编号",
  "name-number": "文件名含编号",
  "name": "文件名",
  "speech": "语音内容",
  "order": "录音顺序",
]
