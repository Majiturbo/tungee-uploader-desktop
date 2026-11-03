import SwiftUI

/// Design concept for the checkup page, shown only with the `--concept` launch flag.
struct CheckupConcept: View {
  @Environment(AppModel.self) private var model
  let summary: PreviewSummary
  @State private var appeared = false

  private var items: [AudioMatchItem] { summary.audioMatch.items.sorted { $0.audioNumber < $1.audioNumber } }
  private var flowItems: [AudioMatchItem] { Array(items.prefix(summary.flowCount)) }
  private var vagueItems: [AudioMatchItem] { Array(items.dropFirst(summary.flowCount).prefix(summary.vagueCount)) }
  private var knowledgeItems: [AudioMatchItem] { Array(items.dropFirst(summary.flowCount + summary.vagueCount)) }
  private var missing: [AudioMatchItem] { items.filter { $0.fileName == nil } }

  static func mood(_ summary: PreviewSummary) -> AmbientLight.Mood {
    if !summary.canUpload { return .error }
    return summary.warningCount > 0 || summary.audioMatch.items.contains { $0.fileName == nil } ? .attention : .calm
  }

  var body: some View {
    content
    .onAppear { withAnimation(.easeOut(duration: 0.01)) { appeared = true } }
  }

  private var content: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 44) {
        header
        structure
        attention
      }
      .frame(maxWidth: 760, alignment: .leading)
      .padding(.horizontal, 48)
      .padding(.top, 44)
      .padding(.bottom, 48)
      .frame(maxWidth: .infinity)
    }
  }

  // MARK: Header

  private var header: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(title)
        .font(.system(size: 42, weight: .semibold, design: .serif))
        .contentTransition(.numericText())
      Text(subtitle)
        .font(.title3)
        .foregroundStyle(.secondary)
      Text(model.subtitle)
        .font(.callout)
        .foregroundStyle(.tertiary)
        .lineLimit(1)
        .truncationMode(.middle)
    }
  }

  private var title: String {
    guard summary.canUpload else { return "还有 \(summary.errorCount) 处要先改" }
    return "\(summary.plannedUploadCount) 条录音都就位了"
  }

  private var subtitle: String {
    guard summary.canUpload else { return "改好后重新检查，就能上传。" }
    if missing.isEmpty { return "每一条都有录音，可以直接上传。" }
    let numbers = missing.prefix(3).map { "\($0.audioNumber)" }.joined(separator: "、")
    return "还差 \(numbers) 号的录音，这\(missing.count > 1 ? "几" : "")条会只上传文字。"
  }

  // MARK: Structure

  private var structure: some View {
    VStack(alignment: .leading, spacing: 18) {
      HStack(alignment: .firstTextBaseline) {
        Text("话术结构").font(.title3.weight(.semibold))
        Spacer()
        legend
      }
      VStack(alignment: .leading, spacing: 10) {
        Label("主流程", systemImage: "arrow.right").font(.callout).foregroundStyle(.secondary).labelStyle(.titleOnly)
        FlowStrip(nodes: flowNodes, start: 0, appeared: appeared, converts: Set(summary.convertAudioNumbers))
      }
      HStack(alignment: .top, spacing: 14) {
        Branch(title: "含糊话术", note: "听不清时兜底", items: vagueItems, start: flowItems.count, appeared: appeared, converts: Set(summary.convertAudioNumbers))
          .frame(width: 200)
        Branch(title: "知识库", note: "客户提问时回答", items: knowledgeItems, start: flowItems.count + vagueItems.count, appeared: appeared, converts: Set(summary.convertAudioNumbers))
      }
      .fixedSize(horizontal: false, vertical: true)
    }
  }

  private var flowNodes: [(name: String, items: [AudioMatchItem])] {
    var order: [String] = []
    var groups: [String: [AudioMatchItem]] = [:]
    for item in flowItems {
      let base = item.label.split(separator: "-").first.map(String.init) ?? item.label
      let name = base.replacing(#/\d+$/#, with: "")
      if groups[name] == nil { order.append(name) }
      groups[name, default: []].append(item)
    }
    return order.map { ($0, groups[$0]!) }
  }

  private var legend: some View {
    HStack(spacing: 14) {
      legendItem(RecordingDot(state: .matched), "已配对")
      legendItem(RecordingDot(state: .converted), "会转格式")
      legendItem(RecordingDot(state: .missing), "缺录音")
    }
    .font(.callout)
    .foregroundStyle(.secondary)
  }

  private func legendItem(_ dot: RecordingDot, _ text: String) -> some View {
    HStack(spacing: 6) { dot; Text(text) }
  }

  // MARK: Attention

  private var attention: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("需要你看一眼").font(.title3.weight(.semibold))
      VStack(spacing: 0) {
        ForEach(missing) { item in
          ConceptRow(symbol: "waveform.slash", tint: .orange,
                     title: "\(item.audioNumber) 号没有找到录音",
                     detail: "\(item.label) · 文字照常上传。补上录音后重新检查即可。",
                     action: "打开文件夹") {
            NSWorkspace.shared.open(URL(fileURLWithPath: model.config.audioDir))
          }
          Divider().padding(.leading, 40)
        }
        let counts = model.checkupCounts
        if counts.total > 0 {
          ConceptRow(symbol: "wand.and.stars", tint: .blue,
                     title: "有 \(counts.fixable) 处可以一键修好",
                     detail: "重复的问法、多余的语气词，另存为新文件，原文件不动。",
                     action: "去看看") { model.checkupOpen = true }
        }
      }
    }
  }
}

// MARK: - Pieces

struct RecordingDot: View {
  enum State { case matched, converted, missing, review }
  let state: State
  var size: CGFloat = 11

  var body: some View {
    ZStack {
      switch state {
      case .matched:
        Circle().fill(Color.accentColor)
      case .converted:
        Circle().fill(Color.accentColor)
        Circle().fill(.white).frame(width: size * 0.36, height: size * 0.36)
      case .review:
        Circle().fill(Color.orange)
      case .missing:
        Circle().strokeBorder(Color.orange, style: StrokeStyle(lineWidth: 1.5, dash: [2.2, 1.8]))
      }
    }
    .frame(width: size, height: size)
  }
}

private struct Dots: View {
  let items: [AudioMatchItem]
  let start: Int
  let appeared: Bool
  let converts: Set<Int>
  var wraps = true
  @State private var hovered: Int?

  var body: some View {
    if wraps {
      Flow(spacing: 6) { dots }
    } else {
      HStack(spacing: 6) { dots }
    }
  }

  private var dots: some View {
    ForEach(Array(items.enumerated()), id: \.element.id) { offset, item in
        RecordingDot(state: state(item))
          .scaleEffect(hovered == item.audioNumber ? 1.45 : appeared ? 1 : 0.2)
          .opacity(appeared ? 1 : 0)
          .animation(.spring(duration: 0.45, bounce: 0.3).delay(Double(start + offset) * 0.014), value: appeared)
          .animation(.spring(duration: 0.2), value: hovered)
          .onHover { hovered = $0 ? item.audioNumber : nil }
          .help("\(item.audioNumber) 号 · \(item.label)\n\(item.fileName ?? "没有录音")")
    }
  }

  private func state(_ item: AudioMatchItem) -> RecordingDot.State {
    if item.fileName == nil { return .missing }
    if item.needsReview { return .review }
    return converts.contains(item.audioNumber) ? .converted : .matched
  }
}

private struct FlowStrip: View {
  let nodes: [(name: String, items: [AudioMatchItem])]
  let start: Int
  let appeared: Bool
  let converts: Set<Int>

  var body: some View {
    HStack(alignment: .center, spacing: 0) {
      ForEach(Array(nodes.enumerated()), id: \.offset) { index, node in
        if index > 0 {
          Image(systemName: "chevron.right")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.tertiary)
            .frame(width: 26)
        }
        VStack(alignment: .leading, spacing: 9) {
          HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(node.name).fontWeight(.medium)
            Text("\(node.items.count)").foregroundStyle(.secondary).monospacedDigit()
          }
          Dots(items: node.items, start: start + offsetBefore(index), appeared: appeared, converts: converts, wraps: false)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
      }
    }
  }

  private func offsetBefore(_ index: Int) -> Int {
    nodes.prefix(index).reduce(0) { $0 + $1.items.count }
  }
}

private struct Branch: View {
  let title: String
  let note: String
  let items: [AudioMatchItem]
  let start: Int
  let appeared: Bool
  let converts: Set<Int>

  var body: some View {
    VStack(alignment: .leading, spacing: 9) {
      HStack(alignment: .firstTextBaseline, spacing: 5) {
        Text(title).fontWeight(.medium)
        Text("\(items.count)").foregroundStyle(.secondary).monospacedDigit()
      }
      .help(note)
      Dots(items: items, start: start, appeared: appeared, converts: converts)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 12)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
  }
}

private struct ConceptRow: View {
  let symbol: String
  let tint: Color
  let title: String
  let detail: String
  let action: String
  let run: () -> Void

  var body: some View {
    HStack(alignment: .center, spacing: 14) {
      Image(systemName: symbol).font(.system(size: 17)).foregroundStyle(tint).frame(width: 26)
      VStack(alignment: .leading, spacing: 3) {
        Text(title).fontWeight(.medium)
        Text(detail).font(.callout).foregroundStyle(.secondary)
      }
      Spacer(minLength: 12)
      Button(action, action: run)
    }
    .padding(.vertical, 13)
  }
}

/// Slow, soft light at the top of the page whose hue reflects the check result.
struct AmbientLight: View {
  enum Mood { case calm, attention, error }
  let mood: Mood
  @Environment(\.colorScheme) private var scheme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var drift = false

  private func glow(_ color: Color, _ size: CGFloat, x: CGFloat, y: CGFloat) -> some View {
    Ellipse()
      .fill(color.opacity(scheme == .dark ? 0.34 : 0.20))
      .frame(width: size, height: size * 0.6)
      .blur(radius: 60)
      .offset(x: x, y: y)
  }

  private var colors: [Color] {
    switch mood {
    case .calm: [.blue, .cyan, .indigo]
    case .attention: [.blue, .orange, .cyan]
    case .error: [.red, .orange, .pink]
    }
  }

  var body: some View {
    GeometryReader { proxy in
      let width = proxy.size.width
      ZStack(alignment: .topLeading) {
        glow(colors[0], width * 0.62, x: width * (drift ? 0.05 : 0.12), y: -70)
        glow(colors[1], width * 0.55, x: width * (drift ? 0.42 : 0.36), y: -120)
        glow(colors[2], width * 0.45, x: width * (drift ? 0.70 : 0.76), y: 10)
      }
      .frame(width: width, height: proxy.size.height, alignment: .topLeading)
    }
    .clipped()
    .onAppear {
      guard !reduceMotion else { return }
      withAnimation(.easeInOut(duration: 9).repeatForever(autoreverses: true)) { drift = true }
    }
    .mask(LinearGradient(colors: [.black, .black.opacity(0.6), .clear], startPoint: .top, endPoint: .bottom))
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}
