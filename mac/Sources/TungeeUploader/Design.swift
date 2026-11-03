import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// Scrolling page container with a centered reading width.
struct Page<Content: View>: View {
  @ViewBuilder var content: Content

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 44) { content }
          .frame(maxWidth: 760, alignment: .leading)
          .padding(.horizontal, 48)
          .padding(.top, 44)
          .padding(.bottom, 48)
          .frame(maxWidth: .infinity)
      }
      .scrollIndicators(.never)
      .task(id: Tour.shared.focusTarget) {
        guard let target = Tour.shared.focusTarget else { return }
        try? await Task.sleep(for: .seconds(0.15))
        withAnimation(.smooth) { proxy.scrollTo(target) }
      }
    }
  }
}

struct PageBackground: View {
  var body: some View {
    Color(nsColor: .textBackgroundColor).ignoresSafeArea()
  }
}

extension View {
  private static var frostEdge: Color {
    Color(nsColor: NSColor(name: nil) { appearance in
      appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        ? .white.withAlphaComponent(0.07) : .white.withAlphaComponent(0.6)
    })
  }

  /// Backs a translucent system card with frosted material, so the ambient light shows through only faintly.
  func frostedCard(cornerRadius: CGFloat = 12) -> some View {
    groupBoxStyle(FrostedGroupBoxStyle()).modifier(FrostedBacking(cornerRadius: cornerRadius, edge: Self.frostEdge))
  }

  /// Mirrors the page background under the sidebar so the sidebar reads as glass floating over the page.
  @ViewBuilder func extendingUnderSidebar() -> some View {
    if #available(macOS 26, *) { backgroundExtensionEffect() } else { self }
  }

  @ViewBuilder func hidingToolbarTitle() -> some View {
    if #available(macOS 15, *) { toolbar(removing: .title) } else { self }
  }

  /// Lets the page run under the toolbar without a toolbar backdrop or titlebar hairline.
  func immersiveToolbar() -> some View {
    modifier(ImmersiveToolbar())
  }
}

private struct FrostedBacking: ViewModifier {
  let cornerRadius: CGFloat
  let edge: Color
  @Environment(\.colorScheme) private var scheme

  func body(content: Content) -> some View {
    content.background {
      let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
      ZStack {
        shape.fill(.ultraThinMaterial).opacity(scheme == .dark ? 0.7 : 0.45)
        shape.strokeBorder(edge, lineWidth: 0.5)
      }
    }
  }
}

/// The system group box layout without its opaque gray fill; `frostedCard` supplies the backing.
private struct FrostedGroupBoxStyle: GroupBoxStyle {
  func makeBody(configuration: Configuration) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      configuration.label
      configuration.content
    }
    .padding(8)
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct ImmersiveToolbar: ViewModifier {
  func body(content: Content) -> some View {
    if #available(macOS 15, *) {
      content
        .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
        .background(TitlebarSeparatorRemover())
    } else {
      content.background(TitlebarSeparatorRemover())
    }
  }
}

private struct TitlebarSeparatorRemover: NSViewRepresentable {
  func makeNSView(context: Context) -> NSView {
    let view = NSView()
    DispatchQueue.main.async { view.window?.titlebarSeparatorStyle = .none }
    return view
  }

  func updateNSView(_ view: NSView, context: Context) {
    view.window?.titlebarSeparatorStyle = .none
  }
}

/// Serif page title with a plain-spoken status line and an optional quiet caption.
struct PageHeader: View {
  let title: String
  var subtitle: String?
  var caption: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(title)
        .font(.system(size: 42, weight: .semibold, design: .serif))
        .contentTransition(.numericText())
        .fixedSize(horizontal: false, vertical: true)
      if let subtitle {
        Text(subtitle).font(.title3).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
          .contentTransition(.opacity)
      }
      if let caption {
        Text(caption).font(.callout).foregroundStyle(.tertiary).lineLimit(1).truncationMode(.middle)
          .contentTransition(.opacity)
      }
      NextStepLine()
    }
    .animation(.smooth(duration: 0.4), value: [title, subtitle ?? "", caption ?? ""])
  }
}

/// Grouped content on the page, in the system group box.
struct Soft<Content: View>: View {
  var padding: CGFloat = 16
  @ViewBuilder var content: Content

  var body: some View {
    GroupBox {
      content
        .padding(max(padding - 8, 0))
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frostedCard()
  }
}

/// Titled section: a system group box with hairline-separated rows.
struct Panel<Content: View>: View {
  var title: String?
  var trailing: String?
  @ViewBuilder var content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let title {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text(title).font(.title3.weight(.semibold))
          if let trailing { Text(trailing).font(.title3).foregroundStyle(.secondary) }
        }
      }
      GroupBox {
        VStack(spacing: 0) { content }
          .padding(.horizontal, 6)
      }
      .frostedCard()
    }
  }
}

struct PanelRow<Leading: View, Trailing: View>: View {
  var divider = true
  @ViewBuilder var leading: Leading
  @ViewBuilder var trailing: Trailing

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 12) {
        leading
        Spacer(minLength: 12)
        trailing
      }
      .padding(.vertical, 12)
      if divider { Divider() }
    }
  }
}

extension PanelRow where Trailing == EmptyView {
  init(divider: Bool = true, @ViewBuilder leading: () -> Leading) {
    self.init(divider: divider, leading: leading) { EmptyView() }
  }
}

struct RowLabel: View {
  let title: String
  var detail: String?

  var body: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
        if let detail {
          Text(detail).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
      }
    }
  }
}

/// Option in a row of choices: the chosen one is a prominent system button.
struct Pill: View {
  let title: String
  let selected: Bool
  let action: () -> Void

  var body: some View {
    Button(title, action: action).prominentGlass(selected)
  }
}

/// Tab switcher: the system tabs picker, or the segmented control before macOS 27.
struct SegmentedTabs<Value: Hashable>: View {
  let items: [(value: Value, title: String)]
  @Binding var selection: Value
  var compact = false

  var body: some View {
    if compact {
      picker.pickerStyle(.segmented)
    } else if #available(macOS 27, *) {
      picker.pickerStyle(.tabs).controlSize(.extraLarge)
    } else if #available(macOS 26, *) {
      picker.pickerStyle(.segmented).controlSize(.extraLarge)
    } else {
      picker.pickerStyle(.segmented)
    }
  }

  private var picker: some View {
    Picker("", selection: $selection.animation(.smooth(duration: 0.35))) {
      ForEach(items, id: \.value) { item in Text(item.title).tag(item.value) }
    }
    .labelsHidden()
    .fixedSize()
  }
}

/// Checkbox row with a free-form label.
struct CheckRow<Label: View>: View {
  @Binding var isOn: Bool
  @ViewBuilder var label: Label

  var body: some View {
    Toggle(isOn: $isOn) {
      HStack(alignment: .firstTextBaseline) { label }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .toggleStyle(.checkbox)
  }
}

/// Wrapping horizontal layout for pills.
struct Flow: Layout {
  var spacing: CGFloat = 8

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? .infinity
    var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
    for view in subviews {
      let size = view.sizeThatFits(.unspecified)
      if x > 0, x + size.width > width { y += line + spacing; x = 0; line = 0 }
      x += size.width + spacing
      line = max(line, size.height)
      widest = max(widest, x - spacing)
    }
    return CGSize(width: min(widest, width), height: y + line)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
    for view in subviews {
      let size = view.sizeThatFits(.unspecified)
      if x > bounds.minX, x + size.width > bounds.maxX { y += line + spacing; x = bounds.minX; line = 0 }
      view.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
      x += size.width + spacing
      line = max(line, size.height)
    }
  }
}

/// Finder icon for a path, or for a content type when nothing is chosen yet.
func finderIcon(_ path: String, fallback: UTType) -> NSImage {
  FileManager.default.fileExists(atPath: path) ? NSWorkspace.shared.icon(forFile: path) : NSWorkspace.shared.icon(for: fallback)
}
