import SwiftUI

struct Ignored: Decodable {
  init(from decoder: Decoder) throws {}
}

private enum CheckupTab: String, CaseIterable, Identifiable {
  case choice, few, qa, auto, hint
  var id: Self { self }
  var title: String {
    switch self {
    case .choice: "需选择"
    case .few: "补问法"
    case .qa: "QA 设置"
    case .auto: "自动修正"
    case .hint: "提醒"
    }
  }
}

private enum TypoState: Equatable {
  case idle, running, done(Int), cancelled
}

private enum InvalidAiState: Equatable {
  case idle, running, done(Int), failed(String)
}

struct CheckupSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let checkup: CheckupResult

  @State private var tab: CheckupTab = .hint
  @State private var decisions: [String: String] = [:]
  @State private var saving = false
  @State private var savedPath: String?
  @State private var error: AppErrorInfo?
  @State private var typo: TypoState = .idle
  @State private var aiProgress: AiProgress?
  @State private var aiFindings: [CheckupFinding] = []
  @State private var expanding: Int?
  @State private var candidates: [Int: [String]] = [:]
  @State private var picked: [Int: Set<String>] = [:]
  @State private var expandFailed: Set<Int> = []
  @State private var aiUnavailable: AppErrorInfo?
  @State private var invalidAi: InvalidAiState = .idle
  @State private var aiInvalid: [CheckupFinding] = []

  private var autoFixes: [CheckupFinding] { checkup.findings.filter { $0.isAutoFix && !$0.isQaFlag } }
  private var choices: [CheckupFinding] { checkup.findings.filter { !$0.options.isEmpty && !$0.isAutoFix && !$0.isQaFlag } }
  private var fewPhrases: [CheckupFinding] {
    checkup.findings.filter { $0.kind == "few-phrases" } + checkup.findings.filter { $0.kind == "some-phrases" }
  }
  private var hints: [CheckupFinding] { aiFindings + checkup.findings.filter { $0.options.isEmpty && !$0.isPhraseCount && !$0.isQaFlag } }
  private var specialSuggestions: [CheckupFinding] { checkup.findings.filter { $0.kind == "special-qa" } }
  private var invalidSuggestions: [CheckupFinding] {
    let rules = checkup.findings.filter { $0.kind == "invalid-qa" }
    let known = Set(rules.map(\.id))
    return rules + aiInvalid.filter { !known.contains($0.id) }
  }
  private var qaWarnings: [CheckupFinding] { checkup.findings.filter { $0.kind == "special-question" } }
  private var hasKnowledge: Bool { (model.summary?.knowledgeCount ?? 0) > 0 }

  private var tabs: [CheckupTab] {
    CheckupTab.allCases.filter { tab in
      switch tab {
      case .choice: !choices.isEmpty
      case .few: !fewPhrases.isEmpty
      case .qa: hasKnowledge || !specialSuggestions.isEmpty || !qaWarnings.isEmpty
      case .auto: !autoFixes.isEmpty
      case .hint: true
      }
    }
  }

  private func count(_ tab: CheckupTab) -> Int {
    switch tab {
    case .choice: choices.count
    case .few: fewPhrases.count
    case .qa: specialSuggestions.count + invalidSuggestions.count + qaWarnings.count
    case .auto: autoFixes.count
    case .hint: hints.count
    }
  }

  private var selectedCount: Int { decisions.count + picked.values.filter { !$0.isEmpty }.count }
  private var aiBusy: Bool { typo == .running || expanding != nil || invalidAi == .running }
  private var saveBlocked: Bool { typo == .running || expanding != nil }
  private var doneCount: Int { fewPhrases.filter { row(of: $0).map { candidates[$0] != nil || expandFailed.contains($0) } ?? true }.count }

  private func row(of finding: CheckupFinding) -> Int? { finding.rowNumbers.first }

  var body: some View {
    VStack(spacing: 0) {
      VStack(alignment: .leading, spacing: 16) {
        VStack(alignment: .leading, spacing: 3) {
          Text("话术体检").font(.system(size: 30, weight: .semibold, design: .serif))
          Text("\(checkup.findings.count) 项 · 修正会另存为新文件，原文件不变").foregroundStyle(.secondary)
        }
        SegmentedTabs(items: tabs.map { ($0, count($0) > 0 ? "\($0.title) \(count($0))" : $0.title) }, selection: $tab)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 32)
      .padding(.top, 28)
      .padding(.bottom, 8)

      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          if let error {
            Callout(symbol: "xmark.octagon.fill", tint: .red, title: error.message, detail: error.suggestion).padding(.bottom, 16)
          }
          if let savedPath {
            HStack {
              Callout(symbol: "checkmark.circle.fill", tint: .green, title: "已另存并复查通过", detail: URL(fileURLWithPath: savedPath).lastPathComponent)
              Button("改用修正版") { model.useFixedWorkbook(savedPath) }
            }
            .padding(.bottom, 16)
          }
          VStack(alignment: .leading, spacing: 0) {
            switch tab {
            case .choice: choiceTab
            case .few: fewTab
            case .qa: qaTab
            case .auto: autoTab
            case .hint: hintTab
            }
          }
          .id(tab)
          .transition(.blurReplace)
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .disabled(saving)

      Divider()
      HStack(spacing: 10) {
        Text(saveBlocked ? "AI 写完后可以保存" : "已选 \(selectedCount) 项")
          .foregroundStyle(.secondary)
        Spacer()
        Button("关闭") { close() }.secondaryGlass().keyboardShortcut(.cancelAction).disabled(saving)
        Button { Task { await save() } } label: {
          if saving { ProgressView().controlSize(.small) }
          Text(saving ? "正在生成" : "另存修正版")
        }
        .prominentGlass(!(selectedCount == 0 || saving || saveBlocked))
        .keyboardShortcut(.defaultAction)
        .disabled(selectedCount == 0 || saving || saveBlocked)
      }
      .controlSize(.large)
      .padding(.horizontal, 32)
      .padding(.vertical, 16)
    }
    .frame(width: 720, height: 680)
    .secondaryGlass()
    .background(PageBackground())
    .onAppear {
      decisions = Dictionary(uniqueKeysWithValues: checkup.findings.compactMap { finding in finding.defaultOption.map { (finding.id, $0) } })
      let requested = (model.checkupTab ?? DevScript.value("--tab")).flatMap(CheckupTab.init(rawValue:))
      tab = requested.flatMap { tabs.contains($0) ? $0 : nil } ?? tabs.first ?? .hint
      model.checkupTab = nil
      model.sidecar.onAiProgress = { progress in aiProgress = progress }
    }
    .task {
      await expandAll()
      if hasKnowledge { await runInvalidAi() }
    }
    .onDisappear { model.sidecar.onAiProgress = nil }
  }

  // MARK: Tabs

  private func lead(_ text: String) -> some View {
    Text(text).font(.title3).foregroundStyle(.secondary).padding(.bottom, 12)
  }

  private func block<Content: View>(last: Bool, @ViewBuilder _ content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      content().padding(.vertical, 18)
      if !last { Divider() }
    }
  }

  private func groupHeader(_ kind: String, _ count: Int) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text(checkupKindLabels[kind] ?? kind).font(.title3.weight(.semibold))
        Text("\(count)").font(.title3).foregroundStyle(.secondary)
      }
      if let note = checkupKindNotes[kind] { Text(note).foregroundStyle(.secondary) }
    }
    .padding(.top, 22)
    .padding(.bottom, 4)
  }

  @ViewBuilder private var choiceTab: some View {
    lead("同一句问法写在了两个问题里，选一个保留。")
    ForEach(Array(choices.enumerated()), id: \.element.id) { index, finding in
      block(last: index == choices.count - 1) {
        VStack(alignment: .leading, spacing: 12) {
          VStack(alignment: .leading, spacing: 4) {
            ForEach(finding.examples, id: \.self) { Text($0).font(.title3) }
          }
          Flow {
            ForEach(finding.options) { option in
              let label = option.label.hasPrefix("只") ? String(option.label.dropFirst()) : option.label
              Pill(title: label, selected: decisions[finding.id] == option.id) { choose(finding.id, option.id) }
            }
            Pill(title: "不处理", selected: decisions[finding.id] == nil) { choose(finding.id, nil) }
          }
        }
      }
    }
  }

  @ViewBuilder private var fewTab: some View {
    lead(fewStatus)
    if let aiUnavailable {
      Callout(symbol: "exclamationmark.triangle.fill", tint: .orange, title: aiUnavailable.message, detail: aiUnavailable.suggestion)
        .padding(.bottom, 12)
    }
    ForEach(grouped(fewPhrases), id: \.kind) { group in
      groupHeader(group.kind, group.items.count)
      ForEach(Array(group.items.enumerated()), id: \.element.id) { index, finding in
        phraseBlock(finding, last: index == group.items.count - 1)
      }
    }
  }

  @ViewBuilder private func phraseBlock(_ finding: CheckupFinding, last: Bool) -> some View {
    let row = row(of: finding) ?? 0
    let list = candidates[row]
    let chosen = picked[row] ?? []
    block(last: last) {
      VStack(alignment: .leading, spacing: 12) {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(finding.title).font(.title3.weight(.semibold))
          Text("现有 \(finding.examples.count) 条").foregroundStyle(.secondary).help(finding.examples.joined(separator: "\n"))
          Spacer()
          if list != nil || expandFailed.contains(row) {
            if let list, !list.isEmpty {
              Button(chosen.count == list.count ? "全不选" : "全选") { picked[row] = chosen.count == list.count ? [] : Set(list); savedPath = nil }
                .buttonStyle(.link)
            }
            Button("换一批", systemImage: "arrow.clockwise") { Task { _ = await expand(row, fresh: true) } }
              .buttonStyle(.link)
              .disabled(aiBusy)
          }
        }
        if expanding == row {
          HStack(spacing: 8) { ProgressView().controlSize(.small); Text("正在写…").foregroundStyle(.secondary) }
        } else if expandFailed.contains(row) {
          Text("没写出来，点“换一批”再试。").foregroundStyle(.secondary)
        } else if let list {
          if list.isEmpty { Text("这批没有合适的（重复或意思不准的已去掉），点“换一批”再试。").foregroundStyle(.secondary) }
          VStack(alignment: .leading, spacing: 10) {
            ForEach(list, id: \.self) { phrase in
              CheckRow(isOn: Binding(get: { chosen.contains(phrase) }, set: { togglePhrase(row, phrase, $0) })) { Text(phrase) }
            }
          }
        } else if aiUnavailable == nil {
          Text("排队中").foregroundStyle(.tertiary)
        }
      }
    }
  }

  @ViewBuilder private var qaTab: some View {
    lead("特殊QA 命中后立即挂断；无效QA 不计入意向。勾选的会在修正版里填「是」。")
    if !qaWarnings.isEmpty {
      groupHeader("special-question", qaWarnings.count)
      ForEach(Array(qaWarnings.enumerated()), id: \.element.id) { index, finding in
        VStack(alignment: .leading, spacing: 0) {
          HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 2) {
              Text(finding.title)
              if let example = finding.examples.first { Text(example).font(.callout).foregroundStyle(.secondary) }
            }
          }
          .padding(.vertical, 11)
          if index < qaWarnings.count - 1 { Divider().padding(.leading, 29) }
        }
      }
    }
    groupHeader("special-qa", specialSuggestions.count)
    if specialSuggestions.isEmpty {
      Text("没有发现以结束语收尾却没设特殊QA的问题。").foregroundStyle(.secondary).padding(.vertical, 11)
    }
    ForEach(Array(specialSuggestions.enumerated()), id: \.element.id) { index, finding in
      flagRow(finding, detail: finding.examples.first, last: index == specialSuggestions.count - 1)
    }
    groupHeader("invalid-qa", invalidSuggestions.count)
    HStack(spacing: 8) {
      if invalidAi == .running { ProgressView().controlSize(.small) }
      Text(invalidAiStatus).font(.callout).foregroundStyle(.secondary)
      if invalidAi == .running, let aiProgress, aiProgress.total > 0 {
        ProgressView(value: Double(aiProgress.current), total: Double(aiProgress.total)).frame(maxWidth: 160)
      }
    }
    .padding(.vertical, 6)
    ForEach(Array(invalidSuggestions.enumerated()), id: \.element.id) { index, finding in
      flagRow(finding, detail: finding.message, last: index == invalidSuggestions.count - 1)
    }
  }

  private func flagRow(_ finding: CheckupFinding, detail: String?, last: Bool) -> some View {
    VStack(spacing: 0) {
      CheckRow(isOn: Binding(get: { decisions[finding.id] != nil }, set: { choose(finding.id, $0 ? "fix" : nil) })) {
        VStack(alignment: .leading, spacing: 2) {
          Text(finding.title)
          if let detail { Text(detail).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
        Spacer()
      }
      .padding(.vertical, 11)
      if !last { Divider().padding(.leading, 29) }
    }
  }

  private var invalidAiStatus: String {
    switch invalidAi {
    case .idle: return "按问题名称找出的建议；AI 稍后会再看一遍。"
    case .running:
      if let aiProgress, aiProgress.total > 0, aiProgress.current > 0 { return "AI 正在逐个看问题 \(aiProgress.current)/\(aiProgress.total)" }
      return "AI 正在看哪些问题和意向无关…"
    case .done(let count): return count > 0 ? "AI 又找到 \(count) 条，默认不勾。" : "AI 看完了，没有更多建议。"
    case .failed(let message): return "AI 没能完成：\(message)"
    }
  }

  @ViewBuilder private var autoTab: some View {
    HStack(alignment: .firstTextBaseline) {
      lead("默认全部修正，不需要的点一下取消。")
      Spacer()
      let all = autoFixes.allSatisfy { decisions[$0.id] != nil }
      Button(all ? "全部不选" : "全部选中") { toggleAll(!all) }.buttonStyle(.link)
    }
    ForEach(grouped(autoFixes), id: \.kind) { group in
      groupHeader(group.kind, group.items.count)
      ForEach(Array(group.items.enumerated()), id: \.element.id) { index, finding in
        VStack(spacing: 0) {
          CheckRow(isOn: Binding(get: { decisions[finding.id] != nil }, set: { choose(finding.id, $0 ? finding.defaultOption : nil) })) {
            VStack(alignment: .leading, spacing: 2) {
              Text(finding.title)
              if let example = finding.examples.first {
                Text(example).font(.callout).foregroundStyle(.secondary).lineLimit(1).help(finding.examples.joined(separator: "\n"))
              }
            }
            Spacer()
            if let count = leadingCount(finding.message) { Text(count).font(.callout).foregroundStyle(.secondary).monospacedDigit() }
          }
          .padding(.vertical, 11)
          if index < group.items.count - 1 { Divider().padding(.leading, 29) }
        }
      }
    }
  }

  @ViewBuilder private var hintTab: some View {
    HStack(alignment: .center, spacing: 14) {
      Image(systemName: "sparkles").font(.system(size: 22)).foregroundStyle(.tint).frame(width: 28)
      VStack(alignment: .leading, spacing: 4) {
        Text("AI 查错字漏字").font(.title3.weight(.semibold))
        Text(typoStatus).foregroundStyle(.secondary)
        if typo == .running, let aiProgress, aiProgress.total > 0 {
          ProgressView(value: Double(aiProgress.current), total: Double(aiProgress.total)).frame(maxWidth: 320)
        }
      }
      Spacer()
      if typo == .running {
        Button("取消") { Task { let _: Ignored? = try? await model.sidecar.call("ai:cancel") } }
      } else {
        Button(typo == .idle ? "开始检查" : "重新检查") { Task { await runTypoCheck() } }
          .disabled(expanding != nil || aiUnavailable != nil)
      }
    }
    .padding(.bottom, 6)
    if hints.isEmpty {
      Divider().padding(.vertical, 14)
      Text("没有其它提醒。").foregroundStyle(.secondary)
    }
    ForEach(grouped(hints), id: \.kind) { group in
      groupHeader(group.kind, group.items.count)
      ForEach(Array(group.items.enumerated()), id: \.element.id) { index, finding in
        VStack(alignment: .leading, spacing: 0) {
          VStack(alignment: .leading, spacing: 3) {
            Text(finding.title)
            Text(finding.message).font(.callout).foregroundStyle(.secondary)
            if !finding.examples.isEmpty {
              Text(finding.examples.joined(separator: "  ")).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
            }
          }
          .padding(.vertical, 11)
          if index < group.items.count - 1 { Divider() }
        }
      }
    }
  }

  // MARK: Text

  private var fewStatus: String {
    if aiUnavailable != nil { return "本地 AI 不可用，请在 Excel 里手动补充。" }
    if doneCount < fewPhrases.count { return "AI 正在写候选问法 \(doneCount)/\(fewPhrases.count)" }
    return fewPhrases.contains { $0.kind == "some-phrases" } ? "太少的已勾选 AI 写的问法，偏少的按需勾选。" : "AI 写的问法已勾选，点一下可取消。"
  }

  private var typoStatus: String {
    switch typo {
    case .running:
      if let aiProgress, aiProgress.total > 0, aiProgress.current > 0 { return "正在逐句检查 \(aiProgress.current)/\(aiProgress.total)" }
      return "正在加载本地 AI 模型…"
    case .done(let count): return count > 0 ? "发现 \(count) 处，请逐条核对。" : "没有发现错字漏字。"
    case .idle, .cancelled: return "在本机运行，约 1–3 分钟。"
    }
  }

  private func grouped(_ findings: [CheckupFinding]) -> [(kind: String, items: [CheckupFinding])] {
    var order: [String] = []
    var groups: [String: [CheckupFinding]] = [:]
    for finding in findings {
      if groups[finding.kind] == nil { order.append(finding.kind) }
      groups[finding.kind, default: []].append(finding)
    }
    return order.map { ($0, groups[$0]!) }
  }

  private func leadingCount(_ message: String) -> String? {
    guard let match = message.firstMatch(of: #/^(\d+) 条/#) else { return nil }
    return "\(match.1) 条"
  }

  // MARK: Actions

  private func choose(_ id: String, _ option: String?) {
    savedPath = nil
    error = nil
    decisions[id] = option
  }

  private func toggleAll(_ on: Bool) {
    for finding in autoFixes { choose(finding.id, on ? finding.defaultOption : nil) }
  }

  private func togglePhrase(_ row: Int, _ phrase: String, _ on: Bool) {
    savedPath = nil
    var set = picked[row] ?? []
    if on { set.insert(phrase) } else { set.remove(phrase) }
    picked[row] = set
  }

  private func close() {
    if aiBusy { Task { let _: Ignored? = try? await model.sidecar.call("ai:cancel") } }
    dismiss()
  }

  private func expandAll() async {
    for finding in fewPhrases {
      guard let row = row(of: finding), await expand(row, fresh: false) else { return }
    }
  }

  private func expand(_ row: Int, fresh: Bool) async -> Bool {
    savedPath = nil
    expanding = row
    defer { expanding = nil }
    do {
      let result: ServiceResult<PhrasesPayload> = try await model.sidecar.call("checkup:expand", model.config, row, fresh)
      switch result.status {
      case "cancelled":
        return false
      case "error":
        if result.error?.code == "E-AI-001" {
          aiUnavailable = result.error
          return false
        }
        expandFailed.insert(row)
        return true
      default:
        let phrases = result.payload?.phrases ?? []
        expandFailed.remove(row)
        candidates[row] = phrases
        let optional = checkup.findings.first { $0.rowNumbers.first == row }?.kind == "some-phrases"
        picked[row] = optional ? [] : Set(phrases)
        return true
      }
    } catch {
      self.error = .bridge(error)
      return false
    }
  }

  private func runInvalidAi() async {
    invalidAi = .running
    aiProgress = nil
    do {
      let result: ServiceResult<FindingsPayload> = try await model.sidecar.call("checkup:invalid-ai", model.config)
      switch result.status {
      case "ok":
        let known = Set(checkup.findings.map(\.id))
        aiInvalid = (result.payload?.findings ?? []).filter { !known.contains($0.id) }
        invalidAi = .done(aiInvalid.count)
      case "cancelled":
        invalidAi = .idle
      default:
        invalidAi = .failed(result.error?.message ?? "未知原因")
      }
    } catch {
      invalidAi = .failed(error.localizedDescription)
    }
  }

  private func runTypoCheck() async {
    savedPath = nil
    error = nil
    typo = .running
    aiProgress = nil
    do {
      let result: ServiceResult<FindingsPayload> = try await model.sidecar.call("checkup:ai", model.config)
      switch result.status {
      case "ok":
        aiFindings = result.payload?.findings ?? []
        typo = .done(aiFindings.count)
      case "cancelled":
        typo = .cancelled
      default:
        error = result.error
        typo = .idle
      }
    } catch {
      self.error = .bridge(error)
      typo = .idle
    }
  }

  private func save() async {
    saving = true
    savedPath = nil
    error = nil
    defer { saving = false }
    var additions: [String: [String]] = [:]
    for (row, phrases) in picked where !phrases.isEmpty {
      additions[String(row)] = (candidates[row] ?? []).filter(phrases.contains)
    }
    do {
      let result: ServiceResult<NoPayload> = try await model.sidecar.call("checkup:save-fixed", model.config, decisions, additions)
      if result.status == "saved" { savedPath = result.path } else { error = result.error }
    } catch {
      self.error = .bridge(error)
    }
  }
}
