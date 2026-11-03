import AVFoundation
import SwiftUI

@MainActor
@Observable
final class AudioPlayer: NSObject, AVAudioPlayerDelegate {
  var playing: String?
  private var player: AVAudioPlayer?

  var currentTime: TimeInterval { player?.currentTime ?? 0 }

  func play(_ file: String?, in directory: String) {
    player?.stop()
    guard let file else {
      playing = nil
      return
    }
    player = try? AVAudioPlayer(contentsOf: URL(fileURLWithPath: directory).appending(path: file))
    player?.delegate = self
    playing = player?.play() == true ? file : nil
  }

  func stop() {
    player?.stop()
    playing = nil
  }

  nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    Task { @MainActor in self.playing = nil }
  }
}

struct AudioMatchSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let summary: PreviewSummary
  @State private var mode: MatchMode
  @State private var filter: ListFilter
  @State private var index = 0
  @State private var choices: [Int: String?] = [:]
  @State private var saving = false
  @State private var error: AppErrorInfo?
  @State private var player = AudioPlayer()

  private enum ListFilter: Hashable { case attention, missing, trim, all }
  private enum Tab: Hashable { case review, list(ListFilter) }
  private enum RowState { case matched, inferred, edited, review, missing }

  /** Row to scroll to and highlight, when opened from a recording's card. */
  private let focus: Int?

  init(summary: PreviewSummary, initialMode: MatchMode, focus: Int? = nil) {
    self.summary = summary
    self.focus = focus
    let items = summary.audioMatch.items
    _mode = State(initialValue: initialMode == .review && items.contains(where: \.needsReview) && focus == nil ? .review : .list)
    let opening: ListFilter = initialMode == .trim || DevScript.value("--tab") == "trim" ? .trim
      : items.contains(where: Self.needsLook) && DevScript.value("--tab") != "all" && focus == nil ? .attention : .all
    _filter = State(initialValue: opening)
  }

  private var match: AudioMatchSummary { summary.audioMatch }

  /// Rows that start out unsure or without a recording. Fixed at open so rows don't vanish while being edited.
  private static func needsLook(_ item: AudioMatchItem) -> Bool { item.needsReview || item.fileName == nil }

  private var reviewItems: [AudioMatchItem] { match.items.filter(\.needsReview) }
  private var current: AudioMatchItem? { mode == .review && index < reviewItems.count ? reviewItems[index] : nil }
  private var transcripts: [String: String] {
    Dictionary(match.files.compactMap { file in file.transcript.map { (file.name, $0) } }, uniquingKeysWith: { first, _ in first })
  }

  private func choice(_ item: AudioMatchItem) -> String? {
    if let chosen = choices[item.audioNumber] { return chosen }
    return item.fileName
  }

  private func owner(of file: String) -> Int? {
    match.items.first { choice($0) == file }?.audioNumber
  }

  private func choose(_ item: AudioMatchItem, _ file: String?) {
    error = nil
    choices[item.audioNumber] = .some(file)
    if let file {
      for other in match.items where other.audioNumber != item.audioNumber && choice(other) == file {
        choices.removeValue(forKey: other.audioNumber)
        if other.fileName == file { choices[other.audioNumber] = .some(nil) }
      }
    }
    player.play(file, in: match.audioDir)
  }

  var body: some View {
    VStack(spacing: 0) {
      VStack(alignment: .leading, spacing: 16) {
        HStack(alignment: .bottom) {
          VStack(alignment: .leading, spacing: 3) {
            Text(current != nil ? "确认录音" : "录音匹配").font(.system(size: 30, weight: .semibold, design: .serif))
            Text(current != nil ? "第 \(min(index + 1, reviewItems.count)) 条，共 \(reviewItems.count) 条" : "已自动匹配 \(match.autoCount)/\(match.items.count)")
              .foregroundStyle(.secondary)
              .monospacedDigit()
          }
          Spacer(minLength: 16)
          if tabs.count > 1 { SegmentedTabs(items: tabs, selection: tab) }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 32)
      .padding(.top, 28)
      .padding(.bottom, 12)

      Group {
        if let current {
          review(current)
        } else {
          list
        }
      }
      .transition(.blurReplace)

      if let error {
        Callout(symbol: "xmark.octagon.fill", tint: .red, title: error.message, detail: error.suggestion)
          .padding(.horizontal, 32)
          .padding(.vertical, 12)
      }
      Divider()
      footer
    }
    .frame(width: 720, height: mode == .review ? 600 : 640)
    .secondaryGlass()
    .background(PageBackground())
    .onAppear { if let current { player.play(choice(current), in: match.audioDir) } }
    .onChange(of: index) { if let current { player.play(choice(current), in: match.audioDir) } }
    .onDisappear { player.stop() }
  }

  private static let noRecording = "\u{0}none"

  private func review(_ item: AudioMatchItem) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 8) {
          Text("第 \(item.audioNumber) 号 · \(item.label)").foregroundStyle(.secondary)
          if let reason = item.reason { Text(reason).foregroundStyle(.orange) }
        }
        Text(item.speech).font(.title2).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
      }
      .padding(.horizontal, 32)
      List(selection: Binding<String?>(get: { choice(item) ?? Self.noRecording }, set: { value in
        guard let value else { return }
        choose(item, value == Self.noRecording ? nil : value)
      })) {
        ForEach(item.candidates, id: \.fileName) { candidate in
          candidateRow(item, candidate).tag(candidate.fileName)
        }
        VStack(alignment: .leading, spacing: 2) {
          Text("这条没有录音")
          Text(summary.missingNote(item)).font(.callout).foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .tag(Self.noRecording)
      }
      .listStyle(.inset)
      .padding(.horizontal, 20)
    }
    .background {
      Button("") { player.play(choice(item), in: match.audioDir) }
        .keyboardShortcut(.space, modifiers: [])
        .hidden()
    }
    .disabled(saving)
  }

  private func candidateRow(_ item: AudioMatchItem, _ candidate: AudioMatchCandidate) -> some View {
    let takenBy = owner(of: candidate.fileName).flatMap { $0 == item.audioNumber ? nil : $0 }
    let detail = [
      matchBasisLabels[candidate.basis],
      candidate.score > 0 ? "相似度 \(Int((candidate.score * 100).rounded()))%" : nil,
      takenBy.map { "现在分给第 \($0) 号" },
    ].compactMap { $0 }.joined(separator: " · ")
    return HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 2) {
        Text(candidate.fileName)
        Text(detail.isEmpty ? "未识别出对应关系" : detail).font(.callout).foregroundStyle(.secondary)
        if let transcript = transcripts[candidate.fileName] {
          Text("“\(transcript)”").font(.callout).foregroundStyle(.secondary).lineLimit(2)
        }
      }
      Spacer()
      playButton(candidate.fileName)
    }
    .padding(.vertical, 4)
  }

  private func playButton(_ file: String?) -> some View {
    let playing = file != nil && player.playing == file
    return Button { playing ? player.stop() : player.play(file, in: match.audioDir) } label: {
      Image(systemName: playing ? "stop.fill" : "play.fill").contentTransition(.symbolEffect(.replace))
    }
    .buttonStyle(.borderless)
    .disabled(file == nil)
    .help(playing ? "停止" : "试听")
  }

  // MARK: List

  private var tabs: [(Tab, String)] {
    let look = match.items.filter(Self.needsLook).count
    let missing = match.items.filter { $0.fileName == nil }.count
    var tabs: [(Tab, String)] = []
    if !reviewItems.isEmpty { tabs.append((.review, "逐条确认")) }
    if look > 0 { tabs.append((.list(.attention), "需要看 \(look)")) }
    if missing > 0, missing != look { tabs.append((.list(.missing), "没录音 \(missing)")) }
    if !summary.trimAudioNumbers.isEmpty { tabs.append((.list(.trim), "剪空白 \(summary.trimAudioNumbers.count)")) }
    tabs.append((.list(.all), "全部 \(match.items.count)"))
    return tabs
  }

  private var tab: Binding<Tab> {
    Binding(get: { mode == .review ? .review : .list(filter) }, set: { tab in
      if case .list(let next) = tab {
        mode = .list
        filter = next
      } else {
        mode = .review
      }
    })
  }

  private func shown(_ item: AudioMatchItem) -> Bool {
    switch filter {
    case .attention: Self.needsLook(item)
    case .missing: item.fileName == nil
    case .trim: summary.isTrimmed(item)
    case .all: true
    }
  }

  private func rowState(_ item: AudioMatchItem) -> RowState {
    guard let file = choice(item) else { return .missing }
    let touched = choices[item.audioNumber] != nil
    if touched, file != item.fileName { return .edited }
    if item.needsReview, !touched { return .review }
    return ["number", "name-number", "confirmed"].contains(item.basis) ? .matched : .inferred
  }

  private var groups: [(title: String, items: [AudioMatchItem])] {
    let sections = summary.sections
    return [("主流程", sections.flow), ("含糊话术", sections.vague), ("知识库", sections.knowledge)].filter { !$0.1.isEmpty }
  }

  private var list: some View {
    ScrollViewReader { proxy in
      List {
        ForEach(groups, id: \.title) { group in
          let items = group.items.filter(shown)
          if !items.isEmpty {
            Section("\(group.title) \(items.count)") {
              ForEach(items) { item in
                row(item)
                  .id(item.audioNumber)
                  .listRowBackground(item.audioNumber == focus ? RoundedRectangle(cornerRadius: 6).fill(Color.accentColor.opacity(0.12)) : nil)
              }
            }
          }
        }
      }
      .listStyle(.inset)
      .padding(.horizontal, 20)
      .disabled(saving)
      .task {
        guard let focus else { return }
        try? await Task.sleep(for: .seconds(0.1))
        proxy.scrollTo(focus, anchor: .center)
      }
    }
  }

  private func row(_ item: AudioMatchItem) -> some View {
    let state = rowState(item)
    let file = choice(item)
    // The cut was measured on the matched file; another pick is uploaded as it is until checked again.
    let trim = file != nil && file == item.fileName ? item.trim?.note : nil
    return HStack(spacing: 12) {
      Text("\(item.audioNumber)").monospacedDigit().foregroundStyle(.secondary).frame(width: 26, alignment: .trailing)
      VStack(alignment: .leading, spacing: 2) {
        Text(item.label).lineLimit(1)
        Text(item.speech).font(.callout).foregroundStyle(.secondary).lineLimit(1)
        HStack(spacing: 0) {
          Text(state == .missing ? summary.missingNote(item) : tag(item, state: state))
            .foregroundStyle(state == .missing ? Color.orange : tagColor(state))
          if let trim { Text(" · \(trim)").foregroundStyle(.secondary) }
        }
        .font(.caption)
        .lineLimit(1)
      }
      .help(item.speech)
      Spacer(minLength: 12)
      playButton(file)
      Picker("", selection: Binding(get: { file ?? "" }, set: { choose(item, $0.isEmpty ? nil : $0) })) {
        Text("没有录音").tag("")
        Divider()
        ForEach(files(for: item), id: \.self) { name in
          let owner = owner(of: name).flatMap { $0 == item.audioNumber ? nil : $0 }
          Text(owner.map { "\(name)（现在分给第 \($0) 号）" } ?? name).tag(name)
        }
      }
      .labelsHidden()
      .frame(width: 150)
      .help(file.flatMap { transcripts[$0] }.map { "“\($0)”" } ?? "")
    }
    .padding(.vertical, 4)
  }

  /// Suggested files first, then the rest.
  private func files(for item: AudioMatchItem) -> [String] {
    let suggested = item.candidates.map(\.fileName)
    return suggested + match.files.map(\.name).filter { !suggested.contains($0) }
  }

  private func tag(_ item: AudioMatchItem, state: RowState) -> String {
    switch state {
    case .missing: return ""
    case .edited: return "已修改"
    case .review: return item.reason ?? "待确认"
    default:
      let label = matchBasisShort[item.basis] ?? ""
      return item.basis == "speech" && item.score > 0 ? "\(label) \(Int((item.score * 100).rounded()))%" : label
    }
  }

  private func tagColor(_ state: RowState) -> Color {
    switch state {
    case .review: .orange
    case .edited: .accentColor
    default: .secondary
    }
  }

  private var changedCount: Int {
    choices.filter { number, file in match.items.first { $0.audioNumber == number }?.fileName != file }.count
  }

  private var footer: some View {
    HStack(spacing: 10) {
      if current != nil {
        Button("上一条", systemImage: "chevron.left") { index -= 1 }
          .secondaryGlass()
          .disabled(saving || index == 0)
          .keyboardShortcut(.leftArrow, modifiers: [])
        Text("↑↓ 选择 · 空格重播").foregroundStyle(.tertiary).lineLimit(1)
        Spacer()
        Button("剩下的都用推荐") { finishReview() }.secondaryGlass().disabled(saving)
        Button(index + 1 < reviewItems.count ? "确认，下一条" : "确认完成") { confirmCurrent() }
          .prominentGlass(!saving)
          .keyboardShortcut(.defaultAction)
          .disabled(saving)
      } else {
        Text(changedCount > 0 ? "已修改 \(changedCount) 条" : match.unusedFiles.isEmpty ? "可以在这里改任意一条" : "没用上的文件不会上传：\(match.unusedFiles.joined(separator: "、"))")
          .foregroundStyle(.secondary).lineLimit(1)
        Spacer()
        Button("关闭") { dismiss() }.secondaryGlass().keyboardShortcut(.cancelAction).disabled(saving)
        Button("保存修改") { Task { await save(choices) } }
          .prominentGlass(!(saving || choices.isEmpty))
          .keyboardShortcut(.defaultAction)
          .disabled(saving || choices.isEmpty)
      }
      if saving { ProgressView().controlSize(.small) }
    }
    .controlSize(.large)
    .padding(.horizontal, 32)
    .padding(.vertical, 16)
  }

  private func confirmCurrent() {
    if index + 1 < reviewItems.count { index += 1 } else { finishReview() }
  }

  private func finishReview() {
    var entries = choices
    for item in reviewItems { entries[item.audioNumber] = .some(choice(item)) }
    Task { await save(entries) }
  }

  private func save(_ entries: [Int: String?]) async {
    saving = true
    error = nil
    player.stop()
    defer { saving = false }
    let decisions = Dictionary(uniqueKeysWithValues: entries.map { (String($0.key), $0.value) })
    do {
      let result: ServiceResult<NoPayload> = try await model.sidecar.call("audio:confirm-matches", model.config, decisions)
      if result.status == "saved" { model.matchesSaved() } else { error = result.error }
    } catch {
      self.error = .bridge(error)
    }
  }
}

private let matchBasisShort: [String: String] = [
  "confirmed": "已确认",
  "number": "按编号",
  "name-number": "按编号",
  "name": "按文件名",
  "speech": "按内容",
  "order": "按顺序",
]
