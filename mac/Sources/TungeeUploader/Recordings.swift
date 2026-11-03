import SwiftUI

extension PreviewSummary {
  /// Recordings in Excel order, split into main flow, vague answers and knowledge base.
  var sections: (flow: [AudioMatchItem], vague: [AudioMatchItem], knowledge: [AudioMatchItem]) {
    let items = audioMatch.items.sorted { $0.audioNumber < $1.audioNumber }
    return (
      Array(items.prefix(flowCount)),
      Array(items.dropFirst(flowCount).prefix(vagueCount)),
      Array(items.dropFirst(flowCount + vagueCount))
    )
  }

  var missingItems: [AudioMatchItem] { audioMatch.items.filter { $0.fileName == nil }.sorted { $0.audioNumber < $1.audioNumber } }

  /// A knowledge question without a recording is left out of the upload; flow and vague answers still upload their text.
  func isKnowledge(_ item: AudioMatchItem) -> Bool {
    sections.knowledge.contains { $0.audioNumber == item.audioNumber }
  }

  func missingNote(_ item: AudioMatchItem) -> String { isKnowledge(item) ? "不会上传" : "只上传文字" }

  func isTrimmed(_ item: AudioMatchItem) -> Bool { trimAudioNumbers.contains(item.audioNumber) }

  /// Cut, converted, or both before uploading.
  func isProcessed(_ item: AudioMatchItem) -> Bool { convertAudioNumbers.contains(item.audioNumber) || isTrimmed(item) }
}

struct RecordingDot: View {
  enum State { case matched, converted, missing, review, pending, active, done }
  let state: State
  var size: CGFloat = 11
  @SwiftUI.State private var pulse = false

  var body: some View {
    ZStack {
      switch state {
      case .converted, .done:
        Circle().fill(Color.accentColor)
      case .matched:
        Circle().fill(Color.accentColor)
          .overlay(Image(systemName: "checkmark").font(.system(size: size * 0.55, weight: .heavy)).foregroundStyle(.white))
      case .review:
        Circle().fill(Color.orange)
      case .missing:
        Circle().strokeBorder(Color.orange, style: StrokeStyle(lineWidth: 1.5, dash: [2.2, 1.8]))
      case .pending:
        Circle().strokeBorder(Color.secondary.opacity(0.45), lineWidth: 1.5)
      case .active:
        Circle().strokeBorder(Color.accentColor, lineWidth: 2)
        Circle().fill(Color.accentColor.opacity(0.35)).scaleEffect(pulse ? 1.9 : 0.6).opacity(pulse ? 0 : 1)
      }
    }
    .frame(width: size, height: size)
    .onAppear {
      guard state == .active else { return }
      withAnimation(.easeOut(duration: 1.1).repeatForever(autoreverses: false)) { pulse = true }
    }
  }
}

/// Main flow as a row of nodes, vague answers and knowledge base underneath. Each dot is one recording.
struct RecordingMap: View {
  let summary: PreviewSummary
  let state: (AudioMatchItem) -> RecordingDot.State
  var legend: [(RecordingDot.State, String)] = [(.matched, "已配对"), (.converted, "上传前处理"), (.missing, "缺录音")]
  @State private var appeared = false
  @State private var card = DotCardState()

  private static let stateLabels: [RecordingDot.State: String] = [
    .matched: "已配对", .converted: "上传前处理", .missing: "缺录音", .review: "没把握", .pending: "等待", .active: "正在传", .done: "已上传",
  ]

  var body: some View {
    let sections = summary.sections
    VStack(alignment: .leading, spacing: 18) {
      HStack(alignment: .firstTextBaseline) {
        Text("话术结构").font(.title3.weight(.semibold))
        Spacer()
        HStack(spacing: 14) {
          ForEach(Array(legend.enumerated()), id: \.offset) { _, entry in
            HStack(spacing: 6) { RecordingDot(state: entry.0); Text(entry.1) }
          }
        }
        .font(.callout)
        .foregroundStyle(.secondary)
      }
      VStack(alignment: .leading, spacing: 10) {
        Text("主流程").font(.callout).foregroundStyle(.secondary)
        HStack(alignment: .center, spacing: 0) {
          let nodes = flowNodes(sections.flow)
          ForEach(Array(nodes.enumerated()), id: \.offset) { index, node in
            if index > 0 {
              Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary).frame(width: 26)
            }
            Node(title: node.name, count: node.items.count) {
              HStack(spacing: 6) { dots(node.items, start: nodes.prefix(index).reduce(0) { $0 + $1.items.count }) }
            }
          }
        }
      }
      HStack(alignment: .top, spacing: 14) {
        Node(title: "含糊话术", count: sections.vague.count, stretch: true) {
          Flow(spacing: 6) { dots(sections.vague, start: sections.flow.count) }
        }
        .help("听不清或答非所问时兜底")
        .frame(width: 200)
        Node(title: "知识库", count: sections.knowledge.count, stretch: true) {
          Flow(spacing: 6) { dots(sections.knowledge, start: sections.flow.count + sections.vague.count) }
        }
        .help("客户提问时回答")
      }
      .fixedSize(horizontal: false, vertical: true)
    }
    .tourTarget("map")
    .onAppear { appeared = true }
    .onDisappear { card.close() }
    .task {
      guard let number = DevScript.value("--dot").flatMap(Int.init) else { return }
      try? await Task.sleep(for: .seconds(1.2))
      if CommandLine.arguments.contains("--detail") { card.tap(number) } else { card.hover(number, true) }
      guard CommandLine.arguments.contains("--close") else { return }
      try? await Task.sleep(for: .seconds(1))
      card.close()
    }
    .overlayPreferenceValue(DotAnchorKey.self) { anchors in
      GeometryReader { proxy in
        ZStack {
          ForEach(card.entries) { entry in
            if let anchor = anchors[entry.number], let item = summary.audioMatch.items.first(where: { $0.audioNumber == entry.number }) {
              cardView(entry, item, dot: proxy[anchor], proxy: proxy)
            }
          }
        }
        .frame(width: proxy.size.width, height: proxy.size.height)
      }
    }
    .zIndex(card.entries.isEmpty ? 0 : 1)
  }

  private func dots(_ items: [AudioMatchItem], start: Int) -> some View {
    ForEach(Array(items.enumerated()), id: \.element.id) { offset, item in
      HoverDot(item: item, state: state(item), card: card)
        .scaleEffect(appeared ? 1 : 0.2)
        .opacity(appeared ? 1 : 0)
        .animation(.spring(duration: 0.45, bounce: 0.3).delay(Double(start + offset) * 0.014), value: appeared)
    }
  }

  // MARK: Card

  private func cardView(_ entry: DotCardState.Entry, _ item: AudioMatchItem, dot: CGRect, proxy: GeometryProxy) -> some View {
    let width = entry.expanded ? DotCard.detailWidth : DotCard.peekWidth
    let left = min(max(dot.midX - width / 2, -40), proxy.size.width - width + 40)
    let arrowX = dot.midX - left
    let origin = proxy.frame(in: .global).origin
    let windowHeight = NSApp.keyWindow?.contentView?.bounds.height ?? 760
    let top = origin.y + dot.minY, bottom = origin.y + dot.maxY
    let need = DotCard.detailRoom + 16
    let below = bottom + need < windowHeight || (top - need < 52 && windowHeight - bottom > top - 52)
    let tipY = below ? dot.maxY + 5 : dot.minY - 5
    let size = proxy.size
    let dotFrame = dot.offsetBy(dx: origin.x, dy: origin.y)
    let dotState = state(item)
    return DotCard(item: item, summary: summary, state: dotState, stateLabel: label(dotState), section: section(item),
                   expanded: entry.expanded, arrowX: arrowX, below: below, closing: entry.closing, close: card.close,
                   gone: { card.remove(entry.id) })
      .background(GeometryReader { geometry in
        Color.clear.onChange(of: geometry.frame(in: .global), initial: true) { _, frame in
          let inset = DotCard.inset(below: below)
          if !entry.closing {
            card.cardFrame = CGRect(x: frame.minX + inset.leading, y: frame.minY + inset.top,
                                    width: frame.width - inset.leading - inset.trailing, height: frame.height - inset.top - inset.bottom)
          }
        }
      })
      .onChange(of: dotFrame, initial: true) { _, frame in
        if !entry.closing { card.dotFrame = frame }
      }
      .allowsHitTesting(entry.expanded && !entry.closing)
      .offset(x: left - DotCard.side, y: below ? tipY - DotCard.room : tipY + DotCard.room - size.height)
      .frame(width: size.width, height: size.height, alignment: below ? .topLeading : .bottomLeading)
  }

  private func label(_ dotState: RecordingDot.State) -> String {
    legend.first { $0.0 == dotState }?.1 ?? Self.stateLabels[dotState] ?? ""
  }

  private func section(_ item: AudioMatchItem) -> String {
    let sections = summary.sections
    if sections.vague.contains(where: { $0.audioNumber == item.audioNumber }) { return "含糊话术" }
    if sections.knowledge.contains(where: { $0.audioNumber == item.audioNumber }) { return "知识库" }
    let node = flowNodes(sections.flow).first { $0.items.contains { $0.audioNumber == item.audioNumber } }
    return node.map { "主流程 · \($0.name)" } ?? "主流程"
  }

  private func flowNodes(_ items: [AudioMatchItem]) -> [(name: String, items: [AudioMatchItem])] {
    var order: [String] = []
    var groups: [String: [AudioMatchItem]] = [:]
    for item in items {
      let base = item.label.split(separator: "-").first.map(String.init) ?? item.label
      let name = base.replacing(#/\d+$/#, with: "")
      if groups[name] == nil { order.append(name) }
      groups[name, default: []].append(item)
    }
    return order.map { ($0, groups[$0]!) }
  }
}

private struct HoverDot: View {
  let item: AudioMatchItem
  let state: RecordingDot.State
  let card: DotCardState
  @State private var hovered = false

  var body: some View {
    RecordingDot(state: state)
      .id(state == .active)
      .scaleEffect(hovered || card.open == item.audioNumber ? 1.45 : 1)
      .animation(.spring(duration: 0.2), value: hovered || card.open == item.audioNumber)
      .keyframeAnimator(initialValue: 1.0, trigger: card.bounce[item.audioNumber, default: 0]) { content, scale in
        content.scaleEffect(scale)
      } keyframes: { _ in
        SpringKeyframe(1.35, duration: 0.1)
        SpringKeyframe(1.0, duration: 0.3, spring: .bouncy)
      }
      .anchorPreference(key: DotAnchorKey.self, value: .bounds) { [item.audioNumber: $0] }
      // Half the gap between dots on every side, so the whole row is clickable without growing the layout.
      .padding(3)
      .contentShape(Rectangle())
      .onHover { inside in
        hovered = inside
        card.hover(item.audioNumber, inside)
      }
      .onTapGesture { card.tap(item.audioNumber) }
      .padding(-3)
      .accessibilityLabel("\(item.audioNumber) 号 · \(item.label)")
      .accessibilityAddTraits(.isButton)
  }
}

private struct Node<Content: View>: View {
  let title: String
  let count: Int
  var stretch = false
  @ViewBuilder var content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 9) {
      HStack(alignment: .firstTextBaseline, spacing: 5) {
        Text(title).fontWeight(.medium)
        Text("\(count)").foregroundStyle(.secondary).monospacedDigit()
      }
      content
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 12)
    .frame(maxWidth: stretch ? .infinity : nil, maxHeight: stretch ? .infinity : nil, alignment: .topLeading)
    .background(Color.primary.opacity(0.025), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    .frostedCard(cornerRadius: 14)
  }
}

/// A row in "需要你看一眼": tinted glyph, title, detail, optional trailing action.
struct AttentionRow: View {
  let symbol: String
  let tint: Color
  let title: String
  var detail: String?
  var action: String?
  var run: (() -> Void)?

  var body: some View {
    HStack(alignment: .center, spacing: 14) {
      Image(systemName: symbol).font(.system(size: 17)).foregroundStyle(tint).frame(width: 26)
      VStack(alignment: .leading, spacing: 3) {
        Text(title).fontWeight(.medium)
        if let detail { Text(detail).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
      }
      Spacer(minLength: 12)
      if let action, let run { Button(action, action: run) }
    }
    .padding(.vertical, 13)
  }
}

/// Soft light at the top of the page whose hue reflects the current state. The glows move as one sheet, like a
/// silk scarf: every so often a gust sweeps across from the left, lifting it down and to the right before it
/// settles again, with a faint sway in between.
struct AmbientLight: View {
  enum Mood { case calm, attention, error, done }
  let mood: Mood
  @Environment(\.colorScheme) private var scheme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private var colors: [Color] {
    switch mood {
    case .calm: [.blue, .orange, .cyan]
    case .attention: [.orange, .red, .pink]
    case .error: [.red, .pink, .red]
    case .done: [.blue, .green, .mint]
    }
  }

  /// Size and resting spot of each glow as fractions of the page width, left to right.
  private let glows: [(size: Double, x: Double, y: Double)] = [(0.62, 0.085, -70), (0.55, 0.39, -120), (0.50, 0.70, 60)]
  private let gustEvery = 13.0
  /// How long the gust takes to reach each next glow.
  private let gustTravel = 0.7

  var body: some View {
    GeometryReader { proxy in
      let width = proxy.size.width
      TimelineView(.animation(paused: reduceMotion)) { context in
        let t = reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 36000)
        ZStack(alignment: .topLeading) {
          ForEach(glows.indices, id: \.self) { index in
            glow(colors[index], index, width: width, gust: gust(at: t - Double(index) * gustTravel))
          }
        }
        .frame(width: width, height: proxy.size.height, alignment: .topLeading)
        .offset(x: 10 * sin(2 * .pi * t / 23))
        .scaleEffect(x: 1, y: 1 + 0.04 * sin(2 * .pi * t / 17), anchor: .top)
      }
    }
    .clipped()
    .animation(.smooth(duration: 0.8), value: mood)
    .mask(LinearGradient(colors: [.black, .black.opacity(0.6), .clear], startPoint: .top, endPoint: .bottom))
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }

  /// `lift` swells from 0 to 1 and back over the first half of each cycle; `flutter` is the ripple riding on it.
  private func gust(at t: TimeInterval) -> (lift: Double, flutter: Double) {
    let p = (t / gustEvery).truncatingRemainder(dividingBy: 1)
    let q = p < 0 ? p + 1 : p
    guard q < 0.55 else { return (0, 0) }
    let lift = pow(sin(.pi * q / 0.55), 2)
    return (lift, lift * sin(2 * .pi * q * 3))
  }

  /// A soft-edged ellipse drawn as a gradient, which moves every frame without re-running a blur filter.
  private func glow(_ color: Color, _ index: Int, width: CGFloat, gust: (lift: Double, flutter: Double)) -> some View {
    let spot = glows[index]
    let size = width * spot.size
    let tint = color.opacity(scheme == .dark ? 0.34 : 0.20)
    let feather: CGFloat = 90
    return EllipticalGradient(stops: [
      .init(color: tint, location: 0),
      .init(color: tint, location: 0.4),
      .init(color: tint.opacity(0.5), location: 0.72),
      .init(color: tint.opacity(0), location: 1),
    ])
    .frame(width: size + feather * 2, height: size * 0.6 + feather * 2)
    .scaleEffect(x: 1 + 0.04 * gust.lift, y: 1 + 0.10 * gust.lift + 0.03 * gust.flutter, anchor: .top)
    .offset(x: width * spot.x - feather + 40 * gust.lift + 10 * gust.flutter, y: spot.y - feather + 22 * gust.lift)
  }
}
