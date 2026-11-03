import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// Scrolling page container with a centered reading width.
struct Page<Content: View>: View {
  @ViewBuilder var content: Content

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 36) { content }
        .frame(maxWidth: 720, alignment: .leading)
        .padding(.horizontal, 48)
        .padding(.top, 20)
        .padding(.bottom, 40)
        .frame(maxWidth: .infinity)
    }
  }
}

struct PageBackground: View {
  var body: some View {
    Color(nsColor: .textBackgroundColor).ignoresSafeArea()
  }
}

extension View {
  @ViewBuilder func hidingToolbarTitle() -> some View {
    if #available(macOS 15, *) { toolbar(removing: .title) } else { self }
  }

  /// Lets the page run under the toolbar without a toolbar backdrop or titlebar hairline.
  func immersiveToolbar() -> some View {
    modifier(ImmersiveToolbar())
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

struct PageHeader<Accessory: View>: View {
  let title: String
  var subtitle: String?
  @ViewBuilder var accessory: Accessory

  var body: some View {
    HStack(alignment: .center, spacing: 16) {
      accessory
      VStack(alignment: .leading, spacing: 4) {
        Text(title)
          .font(.system(size: 34, weight: .bold))
          .contentTransition(.numericText())
        if let subtitle {
          Text(subtitle).font(.title3).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
        }
      }
    }
    .padding(.bottom, 2)
  }
}

extension PageHeader where Accessory == EmptyView {
  init(title: String, subtitle: String? = nil) {
    self.init(title: title, subtitle: subtitle) { EmptyView() }
  }
}

/// Titled section with hairline-separated rows and no container.
struct Panel<Content: View>: View {
  var title: String?
  var trailing: String?
  @ViewBuilder var content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      if let title {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text(title).font(.title3.weight(.semibold))
          if let trailing { Text(trailing).font(.title3).foregroundStyle(.secondary) }
        }
      }
      VStack(spacing: 0) { content }
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

/// Storage-style proportional bar with a legend underneath.
struct CompositionBar: View {
  struct Part: Identifiable {
    let title: String
    let value: Int
    let detail: String
    let tint: Color
    var id: String { title }
  }

  let parts: [Part]

  var body: some View {
    let total = max(parts.reduce(0) { $0 + $1.value }, 1)
    VStack(alignment: .leading, spacing: 14) {
      GeometryReader { proxy in
        HStack(spacing: 2) {
          ForEach(parts.filter { $0.value > 0 }) { part in
            Rectangle()
              .fill(part.tint)
              .frame(width: max(4, (proxy.size.width - CGFloat(parts.count - 1) * 2) * CGFloat(part.value) / CGFloat(total)))
          }
        }
      }
      .frame(height: 14)
      .clipShape(Capsule())
      HStack(alignment: .top, spacing: 40) {
        ForEach(parts) { part in
          VStack(alignment: .leading, spacing: 2) {
            Text("\(part.value)").font(.system(size: 26, weight: .semibold)).monospacedDigit()
            HStack(spacing: 6) {
              Circle().fill(part.tint).frame(width: 7, height: 7)
              Text(part.title)
            }
            Text(part.detail).font(.callout).foregroundStyle(.secondary).monospacedDigit()
          }
        }
      }
    }
  }
}

/// Capsule option. Selected state is filled with the accent color.
struct Pill: View {
  let title: String
  let selected: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Text(title)
        .padding(.horizontal, 13)
        .padding(.vertical, 6)
        .foregroundStyle(selected ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
        .background(Capsule().fill(selected ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(Color.primary.opacity(0.06))))
        .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    .animation(.easeOut(duration: 0.15), value: selected)
  }
}

/// Reminders-style toggle row: a circle that fills with a checkmark.
struct CheckRow<Label: View>: View {
  @Binding var isOn: Bool
  @ViewBuilder var label: Label

  var body: some View {
    Button { isOn.toggle() } label: {
      HStack(alignment: .firstTextBaseline, spacing: 12) {
        Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
          .font(.system(size: 17))
          .foregroundStyle(isOn ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
          .contentTransition(.symbolEffect(.replace))
        HStack(alignment: .firstTextBaseline) { label }
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(.isToggle)
    .accessibilityValue(isOn ? "已选" : "未选")
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
  path.isEmpty ? NSWorkspace.shared.icon(for: fallback) : NSWorkspace.shared.icon(forFile: path)
}
