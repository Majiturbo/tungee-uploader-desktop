import AppKit
import AVFoundation
import SwiftUI

struct DotAnchorKey: PreferenceKey {
  static let defaultValue: [Int: Anchor<CGRect>] = [:]
  static func reduce(value: inout [Int: Anchor<CGRect>], nextValue: () -> [Int: Anchor<CGRect>]) {
    value.merge(nextValue()) { $1 }
  }
}

/// Which dot's card is showing and how big it is. A peek follows the pointer from dot to dot without
/// reopening; a click turns the peek into the detail card in place.
@MainActor
@Observable
final class DotCardState {
  /// One card on screen. A closing card stays in the list until it has shrunk back into its dot.
  struct Entry: Identifiable, Equatable {
    let id: Int
    var number: Int
    var expanded: Bool
    var closing = false
  }

  private(set) var entries: [Entry] = []
  var bounce: [Int: Int] = [:]
  var cardFrame: CGRect = .zero
  var dotFrame: CGRect = .zero

  private var session = 0
  private var hoverTask: Task<Void, Never>?
  private var lastClosed = Date.distantPast
  private var monitor: Any?

  private var currentIndex: Int? { entries.lastIndex { !$0.closing } }
  var open: Int? { currentIndex.map { entries[$0].number } }
  var expanded: Bool { currentIndex.map { entries[$0].expanded } ?? false }

  func hover(_ number: Int, _ inside: Bool) {
    hoverTask?.cancel()
    guard !expanded else { return }
    if inside {
      if let index = currentIndex {
        entries[index].number = number
      } else if Date().timeIntervalSince(lastClosed) < 0.5 {
        show(number, expanded: false)
      } else {
        hoverTask = Task {
          try? await Task.sleep(for: .seconds(0.3))
          guard !Task.isCancelled else { return }
          self.show(number, expanded: false)
        }
      }
    } else if open == number {
      hoverTask = Task {
        try? await Task.sleep(for: .seconds(0.12))
        guard !Task.isCancelled, !self.expanded, self.open == number else { return }
        self.close()
      }
    }
  }

  func tap(_ number: Int) {
    hoverTask?.cancel()
    if expanded, open == number { return close() }
    if let index = currentIndex, entries[index].number == number {
      withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) { entries[index].expanded = true }
    } else {
      show(number, expanded: true)
    }
    bounce[number, default: 0] += 1
    installMonitor()
  }

  func close() {
    hoverTask?.cancel()
    guard let index = currentIndex else { return }
    bounce[entries[index].number, default: 0] += 1
    entries[index].closing = true
    lastClosed = Date()
    removeMonitor()
  }

  /// Called once a closing card has finished shrinking.
  func remove(_ id: Int) {
    entries.removeAll { $0.id == id }
  }

  private func show(_ number: Int, expanded: Bool) {
    if let index = currentIndex { entries[index].closing = true }
    session += 1
    entries.append(Entry(id: session, number: number, expanded: expanded))
  }

  /// Esc or a click outside the card closes it; a click on its own dot is left to the dot, which toggles it.
  private func installMonitor() {
    guard monitor == nil else { return }
    monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .keyDown]) { [weak self] event in
      guard let self else { return event }
      if event.type == .keyDown {
        guard event.keyCode == 53 else { return event }
        self.close()
        return nil
      }
      guard let content = event.window?.contentView, event.window?.attachedSheet == nil else { return event }
      let point = CGPoint(x: event.locationInWindow.x, y: content.bounds.height - event.locationInWindow.y)
      if !self.cardFrame.contains(point), !self.dotFrame.insetBy(dx: -4, dy: -4).contains(point) { self.close() }
      return event
    }
  }

  private func removeMonitor() {
    if let monitor { NSEvent.removeMonitor(monitor) }
    monitor = nil
  }
}

/// Speech-bubble outline with an arrow pointing at the dot, above or below the card.
struct CardShape: Shape {
  var arrowX: CGFloat
  var below: Bool
  var radius: CGFloat = 12
  static let arrow = CGSize(width: 22, height: 9)

  var animatableData: CGFloat {
    get { arrowX }
    set { arrowX = newValue }
  }

  func path(in rect: CGRect) -> Path {
    let a = Self.arrow
    let body = below ? CGRect(x: rect.minX, y: rect.minY + a.height, width: rect.width, height: rect.height - a.height)
      : CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: rect.height - a.height)
    return Self.outline(body: body, radius: radius, tipX: rect.minX + arrowX, arrow: a, top: below)
  }

  /// A rounded rectangle with the arrow on its top or bottom edge, as one continuous outline so the fill and the
  /// hairline border run from the card straight into the arrow.
  static func outline(body: CGRect, radius r: CGFloat, tipX: CGFloat, arrow: CGSize, top: Bool) -> Path {
    let half = arrow.width / 2
    let x = min(max(tipX, body.minX + r + half), body.maxX - r - half)
    var path = Path()
    path.move(to: CGPoint(x: body.minX + r, y: body.minY))
    if top, arrow.height > 0.1 {
      let edge = body.minY, tip = body.minY - arrow.height
      path.addLine(to: CGPoint(x: x - half, y: edge))
      path.addCurve(to: CGPoint(x: x, y: tip), control1: CGPoint(x: x - half * 0.45, y: edge), control2: CGPoint(x: x - half * 0.3, y: tip))
      path.addCurve(to: CGPoint(x: x + half, y: edge), control1: CGPoint(x: x + half * 0.3, y: tip), control2: CGPoint(x: x + half * 0.45, y: edge))
    }
    path.addLine(to: CGPoint(x: body.maxX - r, y: body.minY))
    path.addArc(tangent1End: CGPoint(x: body.maxX, y: body.minY), tangent2End: CGPoint(x: body.maxX, y: body.minY + r), radius: r)
    path.addLine(to: CGPoint(x: body.maxX, y: body.maxY - r))
    path.addArc(tangent1End: CGPoint(x: body.maxX, y: body.maxY), tangent2End: CGPoint(x: body.maxX - r, y: body.maxY), radius: r)
    if !top, arrow.height > 0.1 {
      let edge = body.maxY, tip = body.maxY + arrow.height
      path.addLine(to: CGPoint(x: x + half, y: edge))
      path.addCurve(to: CGPoint(x: x, y: tip), control1: CGPoint(x: x + half * 0.45, y: edge), control2: CGPoint(x: x + half * 0.3, y: tip))
      path.addCurve(to: CGPoint(x: x - half, y: edge), control1: CGPoint(x: x - half * 0.3, y: tip), control2: CGPoint(x: x - half * 0.45, y: edge))
    }
    path.addLine(to: CGPoint(x: body.minX + r, y: body.maxY))
    path.addArc(tangent1End: CGPoint(x: body.minX, y: body.maxY), tangent2End: CGPoint(x: body.minX, y: body.maxY - r), radius: r)
    path.addLine(to: CGPoint(x: body.minX, y: body.minY + r))
    path.addArc(tangent1End: CGPoint(x: body.minX, y: body.minY), tangent2End: CGPoint(x: body.minX + r, y: body.minY), radius: r)
    path.closeSubpath()
    return path
  }
}

/// The floating card for one recording: a three-line peek on hover, the full detail on click.
struct DotCard: View {
  @Environment(AppModel.self) private var model
  @Environment(\.colorScheme) private var scheme
  let item: AudioMatchItem
  let summary: PreviewSummary
  let state: RecordingDot.State
  let stateLabel: String
  let section: String
  let expanded: Bool
  let arrowX: CGFloat
  let below: Bool
  let closing: Bool
  let close: () -> Void
  /// Called when the card has shrunk back into its dot after `closing` turned on.
  let gone: () -> Void
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var openedAt = Date()
  @State private var closedAt: Date?
  @State private var moving = true

  private static let openTime = 0.45
  private static let closeTime = 0.4

  static let peekWidth: CGFloat = 240
  static let detailWidth: CGFloat = 360
  /// Height a detail card usually needs. The side is picked for this even while peeking, so the click that
  /// expands the peek grows it in place rather than flipping it over the dot.
  static let detailRoom: CGFloat = 380
  /// Room around the card for the funnel and the shadow; `room` on the dot's side covers the gap and the dot.
  static let room: CGFloat = 22
  static let side: CGFloat = 30
  /// From the arrow tip to the dot's centre.
  static let reach: CGFloat = 5 + 5.5

  static func inset(below: Bool) -> EdgeInsets {
    EdgeInsets(top: below ? room : side, leading: side, bottom: below ? side : room, trailing: side)
  }

  var body: some View {
    let card = self.card
    TimelineView(.animation(paused: !moving)) { context in
      card.modifier(GenieEffect(progress: genie(at: context.date), arrowX: arrowX, below: below, inset: Self.inset(below: below), reach: Self.reach))
    }
    .onAppear {
      openedAt = Date()
      settle(after: Self.openTime)
    }
    .onChange(of: closing, initial: true) { _, closing in
      guard closing else { return }
      if reduceMotion { return gone() }
      closedAt = Date()
      moving = true
      settle(after: Self.closeTime, then: gone)
    }
  }

  /// 1 while poured into the dot, 0 when fully out: eased out of the dot on opening, eased into it on closing.
  private func genie(at date: Date) -> CGFloat {
    if reduceMotion { return 0 }
    func ease(_ t: Double) -> CGFloat { t * t * (3 - 2 * t) }
    if let closedAt {
      return ease(min(max(date.timeIntervalSince(closedAt) / Self.closeTime, 0), 1))
    }
    return 1 - ease(min(max(date.timeIntervalSince(openedAt) / Self.openTime, 0), 1))
  }

  private func settle(after seconds: Double, then done: (() -> Void)? = nil) {
    Task { @MainActor in
      try? await Task.sleep(for: .seconds(seconds + 0.02))
      moving = false
      done?()
    }
  }

  private var card: some View {
    let arrow = CardShape.arrow.height
    return ZStack(alignment: .topLeading) {
      if expanded {
        DotDetail(item: item, summary: summary, state: state, stateLabel: stateLabel, section: section, close: close)
          .transition(.opacity)
      } else {
        peek.transition(.opacity)
      }
    }
    .padding(.horizontal, expanded ? 16 : 12)
    .padding(.top, (expanded ? 14 : 10) + (below ? arrow : 0))
    .padding(.bottom, (expanded ? 14 : 10) + (below ? 0 : arrow))
    .frame(width: expanded ? Self.detailWidth : Self.peekWidth, alignment: .topLeading)
    .background(CardShape(arrowX: arrowX, below: below).fill(scheme == .dark ? Color(white: 0.17) : .white))
    .overlay(CardShape(arrowX: arrowX, below: below).stroke(Color.primary.opacity(0.14), lineWidth: 0.5))
    .shadow(color: .black.opacity(0.18), radius: 20, y: 8)
    .padding(Self.inset(below: below))
    .contentShape(InsetRect(inset: Self.inset(below: below)))
  }

  private var modifyItem: ModifyItem? {
    model.modifyPlan?.items.first { $0.audioNumber == item.audioNumber }
  }

  private var peek: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text("\(item.audioNumber) 号 · \(item.label)").fontWeight(.semibold).lineLimit(1)
        Spacer(minLength: 4)
        Text(section.components(separatedBy: " · ")[0]).font(.caption).foregroundStyle(.tertiary).lineLimit(1).layoutPriority(1)
      }
      Text(item.speech).font(.callout).foregroundStyle(.secondary).lineLimit(2).fixedSize(horizontal: false, vertical: true)
      HStack(spacing: 6) {
        RecordingDot(state: state, size: 9)
        Text(statusLine).font(.callout).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
      }
      .padding(.top, 2)
    }
  }

  private var statusLine: String {
    if model.isModify, let change = modifyItem {
      let summary = change.changeSummary
      return summary.isEmpty ? "不改" : summary
    }
    guard let file = item.fileName else { return model.isModify ? "不换录音" : "没有录音" }
    return "\(file) · \(stateLabel)"
  }
}

/// Everything about one recording, with playback and the way to fix a wrong match.
private struct DotDetail: View {
  @Environment(AppModel.self) private var model
  let item: AudioMatchItem
  let summary: PreviewSummary
  let state: RecordingDot.State
  let stateLabel: String
  let section: String
  let close: () -> Void
  @State private var player = AudioPlayer()
  @State private var durations: [String: TimeInterval] = [:]
  @State private var showAll = false

  private var audioDir: String { summary.audioMatch.audioDir }
  private var transcript: String? { item.fileName.flatMap { name in summary.audioMatch.files.first { $0.name == name }?.transcript } }
  private var modifyItem: ModifyItem? { model.modifyPlan?.items.first { $0.audioNumber == item.audioNumber } }

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      header
      block("话术") {
        Text(item.speech).lineLimit(showAll ? nil : 6).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
        if item.speech.count > 120 {
          Button(showAll ? "收起" : "展开") { withAnimation(.smooth) { showAll.toggle() } }.buttonStyle(.plain).foregroundStyle(Color.accentColor).font(.callout)
        }
      }
      if model.isModify, let change = modifyItem, !change.changeDetails.isEmpty {
        block("这次要改") {
          ForEach(change.changeDetails, id: \.self) { Text($0).font(.callout).fixedSize(horizontal: false, vertical: true) }
        }
      }
      block("录音") { recording }
      if item.needsReview, !item.candidates.isEmpty { candidates }
      footer
    }
    .onDisappear { player.stop() }
  }

  private var header: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      VStack(alignment: .leading, spacing: 2) {
        Text("\(item.audioNumber) 号 · \(item.label)").font(.headline)
        Text(section).font(.caption).foregroundStyle(.secondary)
      }
      Spacer(minLength: 8)
      Text(stateLabel)
        .font(.caption.weight(.medium))
        .foregroundStyle(tint)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(tint.opacity(0.14), in: Capsule())
    }
  }

  private var tint: Color {
    switch state {
    case .missing, .review: .orange
    case .pending: .secondary
    default: .accentColor
    }
  }

  @ViewBuilder private var recording: some View {
    if let file = item.fileName {
      HStack(spacing: 10) {
        playButton(file, prominent: true)
        VStack(alignment: .leading, spacing: 3) {
          HStack(spacing: 6) {
            Text(file).lineLimit(1).truncationMode(.middle)
            if let duration = durations[file] { Text(format(duration)).monospacedDigit().foregroundStyle(.secondary) }
          }
          progress(file)
        }
      }
      .task(id: file) { load(file) }
      if let transcript {
        Text("识别出：“\(transcript)”").font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
      }
      Text([beforeUpload, pairing].compactMap { $0 }.joined(separator: " · "))
        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
    } else {
      Text(model.isModify ? "没有新录音，保持线上原来的录音。"
           : summary.isKnowledge(item) ? "没有找到录音，知识库问题不会上传。" : "没有找到录音，文字照常上传。")
        .font(.callout).foregroundStyle(model.isModify ? AnyShapeStyle(.secondary) : AnyShapeStyle(.orange))
    }
  }

  private var pairing: String {
    if item.basis == "confirmed" { return "人工确认的配对" }
    let label = matchBasisLabels[item.basis] ?? item.basis
    return "按\(label)配对" + (item.basis == "speech" && item.score > 0 ? "，相似度 \(Int((item.score * 100).rounded()))%" : "")
  }

  private var beforeUpload: String? {
    let steps = [summary.isTrimmed(item) ? item.trim?.note : nil,
                 summary.convertAudioNumbers.contains(item.audioNumber) ? "转成 8k WAV" : nil].compactMap { $0 }
    return steps.isEmpty ? nil : "上传前\(steps.joined(separator: "，"))"
  }

  private var candidates: some View {
    block("没把握，最像的是") {
      if let reason = item.reason { Text(reason).font(.callout).foregroundStyle(.orange) }
      ForEach(item.candidates.prefix(2), id: \.fileName) { candidate in
        HStack(spacing: 8) {
          playButton(candidate.fileName, prominent: false)
          Text(candidate.fileName).lineLimit(1).truncationMode(.middle)
          Spacer(minLength: 6)
          Text("\(Int((candidate.score * 100).rounded()))%").monospacedDigit().foregroundStyle(.secondary)
        }
        .font(.callout)
      }
    }
  }

  private var footer: some View {
    HStack(spacing: 10) {
      if item.fileName == nil, !model.isModify {
        Button("打开文件夹") { NSWorkspace.shared.open(URL(fileURLWithPath: audioDir)) }
      }
      Spacer()
      Button("换一个录音…") {
        close()
        model.matchFocus = item.audioNumber
        model.matchMode = .list
      }
      .disabled(model.busy || model.saved != nil)
    }
    .buttonStyle(CardButtonStyle())
  }

  private func block<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
      content()
    }
  }

  private func playButton(_ file: String, prominent: Bool) -> some View {
    let playing = player.playing == file
    return Button { playing ? player.stop() : player.play(file, in: audioDir) } label: {
      Image(systemName: playing ? "stop.fill" : "play.fill")
        .font(.system(size: prominent ? 12 : 10, weight: .semibold))
        .contentTransition(.symbolEffect(.replace))
        .frame(width: prominent ? 30 : 22, height: prominent ? 30 : 22)
        .foregroundStyle(prominent ? AnyShapeStyle(.white) : AnyShapeStyle(Color.accentColor))
        .background(prominent ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(Color.accentColor.opacity(0.12)), in: Circle())
    }
    .buttonStyle(.plain)
    .disabled(model.saved != nil)
    .help(playing ? "停止" : "试听")
  }

  private func progress(_ file: String) -> some View {
    TimelineView(.animation(paused: player.playing != file)) { _ in
      let total = durations[file] ?? 0
      let fraction = player.playing == file && total > 0 ? min(player.currentTime / total, 1) : 0
      if let trim = item.trim, file == item.fileName {
        Waveform(trim: trim, progress: fraction)
      } else {
        Capsule().fill(.quaternary)
          .overlay(alignment: .leading) {
            GeometryReader { proxy in Capsule().fill(Color.accentColor).frame(width: proxy.size.width * fraction) }
          }
          .frame(height: 4)
      }
    }
  }

  private func load(_ file: String) {
    guard durations[file] == nil, model.saved == nil,
          let audio = try? AVAudioPlayer(contentsOf: URL(fileURLWithPath: audioDir).appending(path: file)) else { return }
    durations[file] = audio.duration
  }

  private func format(_ seconds: TimeInterval) -> String {
    let total = Int(seconds.rounded())
    return String(format: "%d:%02d", total / 60, total % 60)
  }
}

/// The recording's shape, with the silence cut before uploading drawn faint and the played part in blue.
private struct Waveform: View {
  let trim: AudioTrimInfo
  let progress: Double

  var body: some View {
    let count = Double(trim.wave.count)
    HStack(spacing: 1.5) {
      ForEach(Array(trim.wave.enumerated()), id: \.offset) { index, level in
        let middle = (Double(index) + 0.5) / count
        let at = middle * trim.duration
        let cut = at < trim.head || at > trim.duration - trim.tail
        RoundedRectangle(cornerRadius: 1)
          .fill(cut ? Color.secondary.opacity(0.18) : middle <= progress ? Color.accentColor : Color.secondary.opacity(0.5))
          .frame(maxWidth: .infinity)
          .frame(height: max(2.5, 18 * level))
      }
    }
    .frame(height: 18)
  }
}

/// The card without the room left around it for the Genie funnel and the shadow, which must not catch clicks
/// meant for the dots underneath.
private struct InsetRect: Shape {
  let inset: EdgeInsets

  func path(in rect: CGRect) -> Path {
    Path(CGRect(x: rect.minX + inset.leading, y: rect.minY + inset.top,
                width: rect.width - inset.leading - inset.trailing, height: rect.height - inset.top - inset.bottom))
  }
}

/// A small bordered button drawn by SwiftUI itself, so the Genie distortion can render it; AppKit-backed
/// controls show up as placeholders inside shader effects.
private struct CardButtonStyle: ButtonStyle {
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.callout)
      .padding(.horizontal, 10)
      .padding(.vertical, 3)
      .background(.quaternary.opacity(configuration.isPressed ? 2 : 1), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
      .foregroundStyle(enabled ? AnyShapeStyle(.primary) : AnyShapeStyle(.tertiary))
      .contentShape(Rectangle())
  }
}
