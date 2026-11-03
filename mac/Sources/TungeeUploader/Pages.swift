import SwiftUI
import UniformTypeIdentifiers

// MARK: - Import

struct ImportView: View {
  @Environment(AppModel.self) private var model
  @FocusState private var nameFocused: Bool
  @FocusState private var categoryFocused: Bool

  static func mood(_ model: AppModel) -> AmbientLight.Mood {
    model.error != nil ? .error : .calm
  }

  var body: some View {
    let modify = model.isModify
    Page {
      VStack(alignment: .leading, spacing: 28) {
        SegmentedTabs(items: [("create", "新建话术"), ("modify", "修改已有话术")],
                      selection: Binding(get: { model.config.mode }, set: { model.setMode($0) }))
          .disabled(model.busy)
          .tourTarget("mode")
        PageHeader(title: title, subtitle: subtitle)
      }
      Banners()
      HStack(alignment: .top, spacing: 14) {
        FileDrop(
          path: model.config.workbookPath, type: .spreadsheet, title: modify ? "改好的话术表格" : "话术表格",
          hint: "探迹标准模板 .xlsx", detail: "Excel 表格",
          choose: model.chooseWorkbook
        ) {
          if !modify { Button("下载模板") { Task { await model.saveTemplate() } }.tourTarget("template") }
        } trailing: {
          Button("怎么填？") { model.templateGuideOpen = true }.tourTarget("templateGuide")
        }
        .tourTarget("well-workbook")
        FileDrop(
          path: model.config.audioDir, type: .folder, title: modify ? "要换的录音" : "录音文件夹",
          hint: modify ? "只放改过的，名字随意" : "WAV、MP3、M4A 都可以",
          detail: (audioCount ?? model.saved.flatMap { _ in model.summary?.audioMatch.files.count }).map { "\($0) 个录音" } ?? "文件夹",
          choose: model.chooseAudioDir
        ) { EmptyView() } trailing: { EmptyView() }
        .tourTarget("well-audio")
      }
      .fixedSize(horizontal: false, vertical: true)
      .tourTarget("files")
      .disabled(model.busy)

      Panel(title: modify ? "要修改的话术" : "话术信息") {
        FieldRow(title: "话术名称", text: binding(\.talkName, limit: 19), limit: 19, divider: !modify, focus: $nameFocused,
                 prompt: modify ? "和探迹里的名字一样" : "必填")
          .tourTarget("field-talkName")
        if !modify {
          FieldRow(title: "知识库分类", text: binding(\.categoryName, limit: 9), limit: 9, divider: false, focus: $categoryFocused)
            .tourTarget("field-category")
        }
      }
      .tourTarget("fields")
      .disabled(model.busy)
    }
    .onChange(of: model.focusRequest) {
      nameFocused = model.focusRequest == "talkName"
      categoryFocused = model.focusRequest == "category"
      model.focusRequest = nil
    }
  }

  private var filesReady: Bool { !model.config.workbookPath.isEmpty && !model.config.audioDir.isEmpty }

  private var title: String {
    if filesReady { return "文件都齐了" }
    if model.isModify { return "修改一套已有话术" }
    if model.config.workbookPath.isEmpty && model.config.audioDir.isEmpty { return "从两份文件开始" }
    return model.config.workbookPath.isEmpty ? "还差话术表格" : "还差录音文件夹"
  }

  private var subtitle: String {
    if model.isModify {
      guard filesReady else { return "拖入改好的 Excel 和要换的录音，只改有变化的地方。" }
      return model.config.talkName.isEmpty ? "填上探迹里这套话术的名字，就可以检查数据了。" : "点右上角“检查数据”，我帮你从头过一遍。"
    }
    guard filesReady else { return "把 Excel 话术表和录音文件夹拖进窗口，或者点下面选取。" }
    if model.config.talkName.isEmpty { return "起个话术名称，就可以检查数据了。" }
    return "点右上角“检查数据”，我帮你从头过一遍。"
  }

  private var audioCount: Int? {
    let dir = model.config.audioDir
    guard !dir.isEmpty, let names = try? FileManager.default.contentsOfDirectory(atPath: dir) else { return nil }
    let audio: Set<String> = ["wav", "mp3", "m4a", "aac", "flac", "ogg"]
    return names.filter { audio.contains(URL(fileURLWithPath: $0).pathExtension.lowercased()) }.count
  }

  private func binding(_ key: WritableKeyPath<UploadConfig, String>, limit: Int) -> Binding<String> {
    Binding(get: { model.config[keyPath: key] }, set: { value in model.update { $0[keyPath: key] = String(value.prefix(limit)) } })
  }
}

/// Soft file well: Finder icon, name, and a drop highlight.
struct FileDrop<Leading: View, Trailing: View>: View {
  let path: String
  let type: UTType
  let title: String
  let hint: String
  let detail: String
  let choose: () -> Void
  @ViewBuilder var leading: Leading
  @ViewBuilder var trailing: Trailing
  @State private var targeted = false

  private var chosen: Bool { !path.isEmpty }

  var body: some View {
    GroupBox {
    VStack(spacing: 0) {
      ZStack(alignment: .bottomTrailing) {
        Image(nsImage: finderIcon(path, fallback: type))
          .resizable()
          .interpolation(.high)
          .frame(width: 84, height: 84)
          .opacity(chosen ? 1 : 0.45)
          .saturation(chosen ? 1 : 0)
          .id(path)
          .transition(.opacity.combined(with: .scale(0.9)))
        if chosen {
          Image(systemName: "checkmark.circle.fill")
            .font(.system(size: 20))
            .symbolRenderingMode(.palette)
            .foregroundStyle(.white, Color.accentColor)
            .background(Circle().fill(.background).padding(2))
            .offset(x: 4, y: 2)
            .transition(.scale.combined(with: .opacity))
        }
      }
      .padding(.bottom, 12)
      Text(chosen ? fileName(path) ?? title : title)
        .font(.title3.weight(.semibold))
        .lineLimit(1)
        .truncationMode(.middle)
        .contentTransition(.opacity)
      Text(chosen ? detail : hint)
        .font(.callout)
        .foregroundStyle(.secondary)
        .padding(.top, 2)
        .contentTransition(.opacity)
      Spacer(minLength: 14)
      HStack(spacing: 14) {
        leading
        Button(chosen ? "更换…" : "选取…", action: choose)
        trailing
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 14)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .frostedCard()
    .overlay {
      if targeted {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
          .strokeBorder(Color(nsColor: .keyboardFocusIndicatorColor), lineWidth: 3)
      }
    }
    .onTapGesture(perform: choose)
    .dropDestination(for: URL.self) { urls, _ in AppModel.shared.drop(urls) } isTargeted: { targeted = $0 }
    .animation(.snappy, value: path)
  }
}

struct FieldRow: View {
  let title: String
  @Binding var text: String
  let limit: Int
  var divider = true
  var focus: FocusState<Bool>.Binding
  var prompt = "必填"

  var body: some View {
    PanelRow(divider: divider) {
      Text(title).frame(width: 90, alignment: .leading)
      TextField(title, text: $text, prompt: Text(prompt))
        .textFieldStyle(.plain)
        .labelsHidden()
        .focused(focus)
    } trailing: {
      Text("\(text.count)/\(limit)")
        .font(.callout.monospacedDigit())
        .foregroundStyle(text.count >= limit ? AnyShapeStyle(.orange) : AnyShapeStyle(.tertiary))
    }
  }
}

func fileName(_ path: String) -> String? {
  path.isEmpty ? nil : URL(fileURLWithPath: path).lastPathComponent
}

// MARK: - Checkup

struct CheckupView: View {
  @Environment(AppModel.self) private var model
  @State private var showAllIssues = false

  static func mood(_ summary: PreviewSummary, modify: Bool = false) -> AmbientLight.Mood {
    if !summary.canUpload { return .error }
    return summary.warningCount > 0 || (!modify && !summary.missingItems.isEmpty) || summary.audioMatch.reviewCount > 0 ? .attention : .calm
  }

  private static let modifyLegend: [(RecordingDot.State, String)] = [(.matched, "有新录音"), (.converted, "上传前处理"), (.pending, "不换录音")]

  var body: some View {
    if let summary = model.summary {
      Page {
        PageHeader(title: title(summary), subtitle: subtitle(summary), caption: "\(model.subtitle) · \(summary.detectedSheetName)")
          .tourTarget("header")
        Banners()
        if model.isModify {
          RecordingMap(summary: summary, state: { dotState($0, summary) }, legend: Self.modifyLegend)
        } else {
          RecordingMap(summary: summary, state: { dotState($0, summary) })
        }
        attention(summary)
      }
    } else {
      Page {
        PageHeader(title: model.checking ? "正在检查…" : "还没有检查",
                   subtitle: model.checking ? "读取表格、配对录音，稍等几秒。" : "导入文件后点右上角“检查数据”。")
        Banners()
      }
    }
  }

  private func dotState(_ item: AudioMatchItem, _ summary: PreviewSummary) -> RecordingDot.State {
    if item.fileName == nil { return model.isModify ? .pending : .missing }
    if item.needsReview { return .review }
    return summary.isProcessed(item) ? .converted : .matched
  }

  private func title(_ summary: PreviewSummary) -> String {
    guard summary.canUpload else { return "还有 \(summary.errorCount) 处要先改" }
    if summary.audioMatch.reviewCount > 0 { return "有 \(summary.audioMatch.reviewCount) 条录音想请你确认" }
    if model.isModify {
      let matched = summary.audioMatch.items.filter { $0.fileName != nil }.count
      return matched > 0 ? "\(matched) 条新录音都配好了" : "表格检查通过"
    }
    return "\(summary.plannedUploadCount) 条录音都就位了"
  }

  private func subtitle(_ summary: PreviewSummary) -> String {
    guard summary.canUpload else { return model.isModify ? "改好 Excel 后重新检查，再和线上对比。" : "改好 Excel 后重新检查，就能上传。" }
    if summary.audioMatch.reviewCount > 0 { return "我不太确定它们和话术的对应关系，点一下逐条听就好。" }
    if model.isModify { return "没有新录音的保持线上原样。下一步和线上对比，看哪些要改。" }
    let missing = summary.missingItems
    if missing.isEmpty { return "每一条都有录音，可以直接上传。" }
    let numbers = missing.prefix(3).map { "\($0.audioNumber)" }.joined(separator: "、")
    let head = "还差 \(numbers)\(missing.count > 3 ? " 等" : " ")号的录音"
    let these = missing.count > 1 ? "这几条" : "这条"
    let skipped = missing.filter(summary.isKnowledge).count
    if skipped == 0 { return "\(head)，\(these)会只上传文字。" }
    if skipped == missing.count { return "\(head)，\(these)知识库问题不会上传。" }
    return "\(head)。缺录音的知识库问题不会上传，其余只传文字。"
  }

  // MARK: Attention

  private struct Row: Identifiable {
    let id: String
    let symbol: String
    let tint: Color
    let title: String
    var detail: String?
    var action: String?
    var run: (() -> Void)?
  }

  private func rows(_ summary: PreviewSummary) -> [Row] {
    var rows: [Row] = []
    let weight = ["error": 0, "warning": 1, "info": 2]
    let issues = summary.issues
      .filter { $0.code != "W-AUDIO-001" }
      .sorted { weight[$0.severity, default: 3] < weight[$1.severity, default: 3] }
    for (index, issue) in issues.enumerated() where issue.severity == "error" {
      rows.append(Row(id: "issue-\(index)", symbol: "xmark.octagon.fill", tint: .red, title: issue.message, detail: issueDetail(issue)))
    }
    if summary.canUpload, summary.audioMatch.reviewCount > 0 {
      rows.append(Row(id: "review", symbol: "questionmark.circle.fill", tint: .orange,
                      title: "\(summary.audioMatch.reviewCount) 条录音没把握",
                      detail: "按语音内容猜的，听一下确认更稳。", action: "逐条确认") { model.matchMode = .review })
    }
    for item in model.isModify ? [] : summary.missingItems {
      rows.append(Row(id: "missing-\(item.audioNumber)", symbol: "waveform.slash", tint: .orange,
                      title: "\(item.audioNumber) 号没有找到录音",
                      detail: "\(item.label) · \(summary.isKnowledge(item) ? "知识库问题没有录音不会上传" : "文字照常上传")，补上录音后重新检查即可。",
                      action: "打开文件夹") {
        NSWorkspace.shared.open(URL(fileURLWithPath: model.config.audioDir))
      })
    }
    let phrases = model.phraseCounts
    if phrases.few + phrases.some > 0 {
      rows.append(Row(id: "phrases", symbol: "text.badge.plus", tint: .accentColor,
                      title: "\(phrases.few + phrases.some) 个问题问法偏少，AI 可以帮你补",
                      detail: phrases.few > 0 ? "其中 \(phrases.few) 个不到 6 条，客户换个说法机器人就可能识别不到。" : "补到 10 条左右识别更稳。",
                      action: "去补充") { model.openCheckup("few") })
    }
    let qa = model.qaCounts
    if qa.warnings > 0 {
      rows.append(Row(id: "qa-warning", symbol: "exclamationmark.triangle.fill", tint: .orange,
                      title: "\(qa.warnings) 条特殊QA的话术是问句",
                      detail: "特殊QA 命中后立即挂断，客户来不及回答。", action: "去看看") { model.openCheckup("qa") })
    }
    if qa.special + qa.invalid > 0 {
      let parts = [qa.special > 0 ? "\(qa.special) 条建议设为特殊QA（命中即挂断）" : nil,
                   qa.invalid > 0 ? "\(qa.invalid) 条可以设为无效QA（不计入意向）" : nil].compactMap { $0 }
      rows.append(Row(id: "qa", symbol: "phone.down.circle", tint: .accentColor,
                      title: "有 \(qa.special + qa.invalid) 条 QA 设置建议", detail: parts.joined(separator: "，") + "。",
                      action: "去看看") { model.openCheckup("qa") })
    }
    let counts = model.checkupCounts
    if counts.fixable > 0 {
      rows.append(Row(id: "fix", symbol: "wand.and.stars", tint: .accentColor,
                      title: "有 \(counts.fixable) 处可以一键修好",
                      detail: "重复的问法、多余的语气词。修好的表格另存一份，原文件不动。", action: "去看看") { model.openCheckup() })
    } else if counts.hints > 0 {
      rows.append(Row(id: "fix", symbol: "text.magnifyingglass", tint: .accentColor,
                      title: "话术里有 \(counts.hints) 处值得留意", detail: "不影响上传，有空可以看看。", action: "去看看") { model.openCheckup("hint") })
    }
    for (index, issue) in issues.enumerated() where issue.severity != "error" {
      rows.append(Row(id: "issue-\(index)", symbol: issue.severity == "warning" ? "exclamationmark.triangle.fill" : "info.circle.fill",
                      tint: issue.severity == "warning" ? .orange : .secondary, title: issue.message, detail: issueDetail(issue)))
    }
    if let reason = summary.audioMatch.speechUnavailable {
      rows.append(Row(id: "speech", symbol: "ear.trianglebadge.exclamationmark", tint: .secondary,
                      title: "这次只按文件名配对", detail: "语音识别没能启动：\(reason)"))
    }
    if !summary.trimAudioNumbers.isEmpty {
      rows.append(Row(id: "trim", symbol: "scissors", tint: .secondary,
                      title: "\(summary.trimAudioNumbers.count) 条录音头尾空白太长，上传前自动剪掉",
                      detail: "开头留 0.2 秒、结尾留 0.3 秒，中间不动，原文件不变。", action: "查看") { model.matchMode = .trim })
    }
    if !summary.convertAudioNumbers.isEmpty {
      rows.append(Row(id: "convert", symbol: "waveform", tint: .secondary,
                      title: "\(summary.convertAudioNumbers.count) 个录音会先转格式",
                      detail: "上传前转成探迹要求的 8k 单声道 WAV，原文件不变。"))
    }
    if summary.audioMatch.smart {
      rows.append(Row(id: "matches", symbol: "list.bullet", tint: .secondary,
                      title: "录音和话术的对应关系", detail: "已自动配对 \(summary.audioMatch.autoCount)/\(summary.audioMatch.items.count)。",
                      action: "查看") { model.matchMode = .list })
    }
    return rows
  }

  @ViewBuilder private func attention(_ summary: PreviewSummary) -> some View {
    let all = rows(summary)
    let limit = 8
    let shown = showAllIssues ? all : Array(all.prefix(limit))
    VStack(alignment: .leading, spacing: 6) {
      Text("需要你看一眼").font(.title3.weight(.semibold))
      VStack(spacing: 0) {
        ForEach(Array(shown.enumerated()), id: \.element.id) { index, row in
          AttentionRow(symbol: row.symbol, tint: row.tint, title: row.title, detail: row.detail, action: row.action, run: row.run)
            .tourTarget(row.id.hasPrefix("missing-") ? "row-missing" : "row-\(row.id)")
          if index < shown.count - 1 { Divider().padding(.leading, 40) }
        }
      }
      .disabled(model.busy)
      .tourTarget("attention")
      if all.count > limit {
        Button(showAllIssues ? "收起" : "还有 \(all.count - limit) 条") { withAnimation { showAllIssues.toggle() } }
          .buttonStyle(.link)
          .padding(.leading, 40)
          .padding(.top, 4)
      }
    }
  }

  private func issueDetail(_ issue: ValidationIssue) -> String {
    let row = issue.rowNumber.map { " 第 \($0) 行" } ?? ""
    return "\(issue.sheetName ?? "Excel")\(row) · \(issue.suggestion)"
  }
}

// MARK: - Settings

struct StorageItem: Decodable, Identifiable {
  var id: String
  var label: String
  var description: String
  var bytes: Int
}

struct StorageUsage: Decodable {
  var items: [StorageItem]
  var totalBytes: Int
}

struct StoragePayload: Decodable { var usage: StorageUsage }

struct SettingsSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var usage: StorageUsage?
  @State private var selected: Set<String> = []
  @State private var clearing = false
  @State private var message: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("设置")
        .font(.system(size: 30, weight: .semibold, design: .serif))
        .padding(.horizontal, 36)
        .padding(.top, 28)
      Form {
        Section {
          if let usage {
            ForEach(usage.items) { item in
              Toggle(isOn: binding(item.id)) {
                Text("\(item.label)  \(Text(bytes(item.bytes)).foregroundStyle(.secondary))")
                Text(item.description)
              }
            }
            HStack {
              if let message { Text(message).foregroundStyle(.secondary) }
              Spacer()
              Button("清理所选") { Task { await clear() } }
                .disabled(selected.isEmpty || clearing || model.busy)
            }
          } else {
            ProgressView().controlSize(.small)
          }
        } header: {
          HStack {
            Text("存储空间")
            Spacer()
            if let usage { Text(bytes(usage.totalBytes)).foregroundStyle(.secondary) }
          }
        }
        Section("关于") {
          LabeledContent {
            Button("重新看一遍") {
              dismiss()
              DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { Tour.shared.start() }
            }
            .disabled(model.busy)
          } label: {
            Text("新手引导")
            Text("用示例话术把四个步骤走一遍")
          }
          LabeledContent {
            Button("打开") { NSWorkspace.shared.open(model.sidecar.paths.logs) }
          } label: {
            Text("运行日志")
            Text("记录每一步操作，排查问题时用")
          }
          LabeledContent("版本", value: version)
        }
        Section {
          LabeledContent {
            Button("写邮件…", action: sendFeedback)
          } label: {
            Text("遇到问题或有建议")
            Text("直接发邮件就好，运行日志会自动附上。邮件里请写清楚做到哪一步、看到了什么提示、你希望它怎样。")
          }
          LabeledContent("邮箱") {
            Link(Self.email, destination: URL(string: "mailto:\(Self.email)")!)
              .contextMenu {
                Button("拷贝邮箱地址") {
                  NSPasteboard.general.clearContents()
                  NSPasteboard.general.setString(Self.email, forType: .string)
                }
              }
          }
          LabeledContent("设计", value: "Design by 马德槐")
        } header: {
          Text("反馈与建议")
        }
      }
      .formStyle(.grouped)
      Divider()
      HStack {
        Spacer()
        Button("完成") { dismiss() }.prominentGlass().keyboardShortcut(.defaultAction).controlSize(.large)
      }
      .padding(20)
    }
    .frame(width: 560, height: 680)
    .secondaryGlass()
    .task { await load() }
  }

  static let email = "3301378498@qq.com"

  private var version: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "开发版"
  }

  private var logFiles: [URL] {
    let dir = model.sidecar.paths.logs
    let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey])) ?? []
    return files.filter { url in
      url.pathExtension == "log" && ((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) < 10_000_000
    }
  }

  /// Opens a new email to the designer with the logs attached; falls back to a mailto link plus the logs in Finder.
  private func sendFeedback() {
    let subject = "探迹话术上传助手 问题反馈"
    let system = ProcessInfo.processInfo.operatingSystemVersionString
    let context = ["版本：\(version)", "系统：macOS \(system)", "当前步骤：\(model.step.title)",
                   model.error.map { "错误代码：\($0.code)" }].compactMap { $0 }.joined(separator: "\n")
    let files = logFiles
    var body = """
    你好，我在使用探迹话术上传助手时遇到了问题。

    【做到哪一步】
    【看到的提示】（可以附截图）
    【希望怎样】

    ——
    \(context)
    """
    if let mail = NSSharingService(named: .composeEmail), mail.canPerform(withItems: [body] + files) {
      mail.recipients = [Self.email]
      mail.subject = subject
      mail.perform(withItems: [body + "\n运行日志已附在邮件里。"] + files)
      return
    }
    body += "\n请把刚打开的运行日志拖进这封邮件。"
    var components = URLComponents(string: "mailto:\(Self.email)")!
    components.queryItems = [URLQueryItem(name: "subject", value: subject), URLQueryItem(name: "body", value: body)]
    if let url = components.url { NSWorkspace.shared.open(url) }
    if files.isEmpty {
      NSWorkspace.shared.open(model.sidecar.paths.logs)
    } else {
      NSWorkspace.shared.activateFileViewerSelecting(files)
    }
  }

  private func binding(_ id: String) -> Binding<Bool> {
    Binding(get: { selected.contains(id) }, set: { if $0 { selected.insert(id) } else { selected.remove(id) } })
  }

  private func bytes(_ value: Int) -> String {
    ByteCountFormatter.string(fromByteCount: Int64(value), countStyle: .file)
  }

  private func load() async {
    let result: ServiceResult<StoragePayload>? = try? await model.sidecar.call("storage:usage")
    usage = result?.payload?.usage
    if let failure = result?.error { message = failure.message }
  }

  private func clear() async {
    clearing = true
    defer { clearing = false }
    do {
      let result: ServiceResult<StoragePayload> = try await model.sidecar.call("storage:clear", Array(selected))
      if let fresh = result.payload?.usage {
        let freed = (usage?.totalBytes ?? 0) - fresh.totalBytes
        usage = fresh
        selected = []
        message = "释放了 \(bytes(max(freed, 0)))"
      } else {
        message = result.error?.message
      }
    } catch {
      message = AppErrorInfo.bridge(error).message
    }
  }
}
