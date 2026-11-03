import AVFoundation
import SwiftUI

@MainActor
@Observable
final class AudioPlayer: NSObject, AVAudioPlayerDelegate {
  var playing: String?
  private var player: AVAudioPlayer?

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
  let match: AudioMatchSummary
  @State private var mode: MatchMode
  @State private var index = 0
  @State private var choices: [Int: String?] = [:]
  @State private var saving = false
  @State private var error: AppErrorInfo?
  @State private var player = AudioPlayer()

  init(match: AudioMatchSummary, initialMode: MatchMode) {
    self.match = match
    _mode = State(initialValue: match.items.contains(where: \.needsReview) ? initialMode : .list)
  }

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
        VStack(alignment: .leading, spacing: 3) {
          Text(current != nil ? "确认录音" : "录音匹配").font(.system(size: 26, weight: .bold))
          Text(current != nil ? "第 \(min(index + 1, reviewItems.count)) 条，共 \(reviewItems.count) 条" : "已自动匹配 \(match.autoCount)/\(match.items.count)")
            .foregroundStyle(.secondary)
            .monospacedDigit()
        }
        if !reviewItems.isEmpty {
          Picker("", selection: $mode) {
            Text("逐条确认").tag(MatchMode.review)
            Text("全部").tag(MatchMode.list)
          }
          .pickerStyle(.segmented)
          .labelsHidden()
          .fixedSize()
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 32)
      .padding(.top, 28)
      .padding(.bottom, 12)

      if let current {
        review(current)
      } else {
        list
      }

      if let error {
        Callout(symbol: "xmark.octagon.fill", tint: .red, title: error.message, detail: error.suggestion)
          .padding(.horizontal, 32)
          .padding(.vertical, 12)
      }
      Divider()
      footer
    }
    .frame(width: 720, height: mode == .review ? 600 : 640)
    .background(PageBackground())
    .onAppear { if let current { player.play(choice(current), in: match.audioDir) } }
    .onChange(of: index) { if let current { player.play(choice(current), in: match.audioDir) } }
    .onDisappear { player.stop() }
  }

  private func review(_ item: AudioMatchItem) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        VStack(alignment: .leading, spacing: 6) {
          HStack(spacing: 8) {
            Text("第 \(item.audioNumber) 号 · \(item.label)").foregroundStyle(.secondary)
            if let reason = item.reason { Text(reason).foregroundStyle(.orange) }
          }
          Text(item.speech).font(.title2).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.bottom, 20)
        Divider()
        ForEach(Array(item.candidates.enumerated()), id: \.element.fileName) { position, candidate in
          candidateRow(item, candidate, key: "\(position + 1)")
          Divider().padding(.leading, 36)
        }
        Button { choose(item, nil) } label: {
          HStack(spacing: 14) {
            KeyCap(text: "N", active: choice(item) == nil)
            VStack(alignment: .leading, spacing: 2) {
              Text("这条没有录音").fontWeight(choice(item) == nil ? .semibold : .regular)
              Text("只上传文本").font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
          }
          .padding(.vertical, 12)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .keyboardShortcut("n", modifiers: [])
      }
      .padding(.horizontal, 32)
      .padding(.vertical, 12)
    }
    .background {
      Button("") { player.play(choice(item), in: match.audioDir) }
        .keyboardShortcut(.space, modifiers: [])
        .hidden()
    }
    .disabled(saving)
  }

  private func candidateRow(_ item: AudioMatchItem, _ candidate: AudioMatchCandidate, key: String) -> some View {
    let takenBy = owner(of: candidate.fileName).flatMap { $0 == item.audioNumber ? nil : $0 }
    let detail = [
      matchBasisLabels[candidate.basis],
      candidate.score > 0 ? "相似度 \(Int((candidate.score * 100).rounded()))%" : nil,
      takenBy.map { "现在分给第 \($0) 号" },
    ].compactMap { $0 }.joined(separator: " · ")
    return Button { choose(item, candidate.fileName) } label: {
      HStack(spacing: 14) {
        KeyCap(text: key, active: choice(item) == candidate.fileName)
        VStack(alignment: .leading, spacing: 2) {
          Text(candidate.fileName).fontWeight(choice(item) == candidate.fileName ? .semibold : .regular)
          Text(detail.isEmpty ? "未识别出对应关系" : detail).font(.callout).foregroundStyle(.secondary)
          if let transcript = transcripts[candidate.fileName] {
            Text("“\(transcript)”").font(.callout).foregroundStyle(.secondary).lineLimit(2)
          }
        }
        Spacer()
        Image(systemName: player.playing == candidate.fileName ? "speaker.wave.2.fill" : "play.fill")
          .foregroundStyle(.tint)
          .symbolEffect(.variableColor.iterative, isActive: player.playing == candidate.fileName)
      }
      .padding(.vertical, 12)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .keyboardShortcut(KeyEquivalent(Character(key)), modifiers: [])
  }

  private var list: some View {
    Table(match.items) {
      TableColumn("编号") { item in Text("\(item.audioNumber)").monospacedDigit().foregroundStyle(.secondary) }
        .width(40)
      TableColumn("模块或问题") { item in
        VStack(alignment: .leading, spacing: 1) {
          Text(item.label).lineLimit(1)
          if item.needsReview, choices[item.audioNumber] == nil, let reason = item.reason {
            Text(reason).font(.caption).foregroundStyle(.orange)
          }
        }
        .help(item.speech)
      }
      TableColumn("录音文件") { item in
        Picker("", selection: Binding(get: { choice(item) ?? "" }, set: { choose(item, $0.isEmpty ? nil : $0) })) {
          Text("没有录音").tag("")
          ForEach(match.files, id: \.name) { file in
            let taken = owner(of: file.name).flatMap { $0 == item.audioNumber ? nil : $0 }
            Text(taken.map { "\(file.name)（现在分给第 \($0) 号）" } ?? file.name).tag(file.name)
          }
        }
        .labelsHidden()
      }
      .width(min: 180, ideal: 220)
      TableColumn("依据") { item in
        let changed = choices[item.audioNumber] != nil && choice(item) != item.fileName
        Text(changed ? "已修改" : item.fileName == nil ? "" : matchBasisLabels[item.basis] ?? "")
          .font(.caption).foregroundStyle(.secondary)
      }
      .width(80)
      TableColumn("") { item in
        Button { player.playing == choice(item) ? player.stop() : player.play(choice(item), in: match.audioDir) } label: {
          Image(systemName: player.playing != nil && player.playing == choice(item) ? "stop.fill" : "play.fill")
        }
        .buttonStyle(.borderless)
        .disabled(choice(item) == nil)
      }
      .width(28)
    }
    .tableStyle(.inset(alternatesRowBackgrounds: false))
    .padding(.horizontal, 20)
    .disabled(saving)
  }

  private var changedCount: Int {
    choices.filter { number, file in match.items.first { $0.audioNumber == number }?.fileName != file }.count
  }

  private var footer: some View {
    HStack(spacing: 10) {
      if current != nil {
        Button("上一条", systemImage: "chevron.left") { index -= 1 }
          .disabled(saving || index == 0)
          .keyboardShortcut(.leftArrow, modifiers: [])
        Text("数字键选择 · N 没有录音 · 空格重播").foregroundStyle(.tertiary).lineLimit(1)
        Spacer()
        Button("剩下的都用推荐") { finishReview() }.disabled(saving)
        Button(index + 1 < reviewItems.count ? "确认，下一条" : "确认完成") { confirmCurrent() }
          .prominentGlass(!saving)
          .keyboardShortcut(.defaultAction)
          .disabled(saving)
      } else {
        Text(changedCount > 0 ? "已修改 \(changedCount) 条" : match.unusedFiles.isEmpty ? "可以在这里改任意一条" : "没用上的文件不会上传：\(match.unusedFiles.joined(separator: "、"))")
          .foregroundStyle(.secondary).lineLimit(1)
        Spacer()
        Button("关闭") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
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

struct KeyCap: View {
  let text: String
  let active: Bool

  var body: some View {
    Text(text)
      .font(.caption.weight(.semibold))
      .monospaced()
      .frame(width: 22, height: 22)
      .foregroundStyle(active ? Color.white : Color.secondary)
      .background(active ? AnyShapeStyle(.tint) : AnyShapeStyle(Color.primary.opacity(0.06)), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
  }
}
