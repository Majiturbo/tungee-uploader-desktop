import SwiftUI

/// Four illustrated pages on filling the standard template. The tables are drawn, not screenshots,
/// so they look the same for Excel, WPS and Numbers users and follow dark mode.
struct TemplateGuideSheet: View {
  @Environment(\.dismiss) private var dismiss
  @State private var page: Int

  init(page: Int = 0) { _page = State(initialValue: min(max(page, 0), Self.pages.count - 1)) }

  var body: some View {
    let current = Self.pages[page]
    let last = page == Self.pages.count - 1
    VStack(spacing: 0) {
      VStack(alignment: .leading, spacing: 16) {
        VStack(alignment: .leading, spacing: 3) {
          Text("怎么填模板").font(.system(size: 30, weight: .semibold, design: .serif))
          Text("四步填好 · Excel、WPS 里操作都一样").foregroundStyle(.secondary)
        }
        SegmentedTabs(items: Self.pages.indices.map { ($0, Self.pages[$0].tab) }, selection: Binding(get: { page }, set: { go($0) }))
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 32)
      .padding(.top, 28)
      .padding(.bottom, 8)

      VStack(alignment: .leading, spacing: 0) {
        Text(current.title).font(.title3.weight(.semibold))
        Text(current.body).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true).padding(.top, 4)
        current.picture
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.top, 16)
        VStack(alignment: .leading, spacing: 10) {
          ForEach(current.points, id: \.text) { point in
            HStack(alignment: .firstTextBaseline, spacing: 10) {
              Image(systemName: point.symbol)
                .foregroundStyle(point.tint)
                .frame(width: 20)
              Text(point.text).fixedSize(horizontal: false, vertical: true)
            }
          }
        }
        .padding(.top, 20)
      }
      .padding(.horizontal, 32)
      .padding(.vertical, 16)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .id(page)
      .transition(.blurReplace)

      Divider()
      HStack(spacing: 10) {
        Text("第 \(page + 1) 步，共 \(Self.pages.count) 步").foregroundStyle(.secondary)
        Spacer()
        if page > 0 { Button("上一步") { go(page - 1) }.secondaryGlass() }
        Button(last ? "知道了" : "下一步") { if last { dismiss() } else { go(page + 1) } }
          .prominentGlass()
          .keyboardShortcut(.defaultAction)
      }
      .controlSize(.large)
      .padding(.horizontal, 32)
      .padding(.vertical, 16)
    }
    .frame(width: 720, height: 680)
    .secondaryGlass()
    .background(PageBackground())
  }

  private func go(_ index: Int) {
    withAnimation(.smooth(duration: 0.35)) { page = index }
  }

  struct Point {
    let symbol: String
    let text: String
    var tint: Color = .accentColor
  }

  struct GuidePage {
    let tab: String
    let title: String
    let body: String
    let picture: AnyView
    let points: [Point]
  }

  static let pages: [GuidePage] = [
    GuidePage(
      tab: "打开工作表",
      title: "打开「话术内容」工作表",
      body: "模板里有两个工作表，要填的是「话术内容」这一张。",
      picture: AnyView(SheetTabsPicture()),
      points: [Point(symbol: "lightbulb", text: "「话术建议」里是推荐加上的问答和更全的问法，可以挑着复制到知识库"),
               Point(symbol: "exclamationmark.triangle", text: "只往格子里填内容，不要增删列、改表头，否则检查不过", tint: .orange)]
    ),
    GuidePage(
      tab: "主流程",
      title: "主流程和含糊话术：粘贴进 E 列",
      body: "第 3–15 行是主流程，第 18–21 行是含糊话术。把你的话术直接粘贴进「客户话术填写列」。",
      picture: AnyView(MiniSheet(columns: flowColumns, rows: flowRows, lit: ["E"], tag: "粘贴到这里")),
      points: [Point(symbol: "waveform", text: "每行对应一条录音，会听录音内容自动配上，文件名随意"),
               Point(symbol: "hand.raised", text: "A–D 列是模板自带的说明和编号，不用改")]
    ),
    GuidePage(
      tab: "知识库",
      title: "知识库：从第 25 行起覆盖 A–E 列",
      body: "把整理好的问题、问法、回答按列对齐，从第 25 行开始粘贴，盖掉模板里的示例。",
      picture: AnyView(MiniSheet(columns: knowledgeColumns, rows: knowledgeRows, lit: ["A", "B", "C", "D", "E"], handle: (28, "D"), tag: "粘贴覆盖")),
      points: [Point(symbol: "list.number", text: "编号改成连续序号：D25、D26 填 18、19，选中这两格，拖右下角的小方块往下拉"),
               Point(symbol: "doc.text.magnifyingglass", text: "录音文件名不用对上编号，会听内容自动配"),
               Point(symbol: "trash", text: "模板示例比你的问题多时，多出来的行整行删掉")]
    ),
    GuidePage(
      tab: "无效QA / 特殊QA",
      title: "无效QA 和特殊QA：需要的填「是」",
      body: "也是从第 25 行起，只在需要的行填「是」，其余留空。",
      picture: AnyView(MiniSheet(columns: flagColumns, rows: flagRows, lit: ["F", "G"], tag: "需要的填「是」")),
      points: [Point(symbol: "minus.circle", text: "无效QA：命中后不计入意向，比如问是不是机器人、说打错了"),
               Point(symbol: "phone.down", text: "特殊QA：命中后立即挂断，回答以「再见」「拜拜」这类结束语收尾的就该设；这类回答别用问句结尾"),
               Point(symbol: "stethoscope", text: "拿不准也没关系，体检会建议哪些行该设")]
    ),
  ]

  private static let flowColumns = [
    MiniColumn("A", 98), MiniColumn("B", 120), MiniColumn("C", 124), MiniColumn("D", 68), MiniColumn("E", 214),
  ]
  private static let flowRows: [MiniRow] = [
    .section(1, "主流程｜固定 13 条"),
    .header(2, ["流程模块", "情景（场景说明）", "示例（仅供参考）", "录音编号", "客户话术填写列"]),
    .data(3, ["开场白", "一开始打电话时…", "喂，您好！", "1", "您好，我是示例公司的小李"]),
    .gap,
    .data(15, ["结束话语04", "用户无回复时…", "不好意思，我这边…", "13", "那先不打扰您了，再见"]),
    .section(16, "含糊话术"),
    .header(17, ["流程模块", "情景（场景说明）", "示例（仅供参考）", "录音编号", "客户话术填写列"]),
    .data(18, ["含糊话术01", "环境吵杂听不清…", "不好意思，听的不…", "14", "抱歉，刚才没听清"]),
    .gap,
    .data(21, ["含糊话术04", "客户说听不清时…", "现在可以听到吗?", "17", "现在能听清吗"]),
  ]

  private static let knowledgeColumns = [
    MiniColumn("A", 94), MiniColumn("B", 156), MiniColumn("C", 90), MiniColumn("D", 56), MiniColumn("E", 228),
  ]
  private static let knowledgeRows: [MiniRow] = [
    .section(23, "知识库｜数量可增减"),
    .header(24, ["问题", "问法", "回答示例", "编号", "客户话术填写列"]),
    .data(25, ["价格多少", "多少钱；怎么收费", "…", "18", "我们按年收费，具体看门店…"]),
    .data(26, ["公司在哪", "你们在哪；地址在哪", "…", "19", "我们在市中心，稍后发您定位"]),
    .data(27, ["加个微信", "加微信；有微信吗", "…", "20", "好的，稍后加您微信"]),
    .data(28, ["不需要", "不用了；没兴趣", "…", "21", "好的，那不打扰您了，再见"]),
    .gap,
  ]

  private static let flagColumns = [
    MiniColumn("A", 118), MiniColumn("…", 32), MiniColumn("E", 258), MiniColumn("F", 108), MiniColumn("G", 108),
  ]
  private static let flagRows: [MiniRow] = [
    .header(24, ["问题", "", "客户话术填写列", "无效QA", "特殊QA"]),
    .data(25, ["价格多少", "", "我们按年收费，具体看门店…", "", ""]),
    .data(26, ["是不是机器人", "", "我是智能助理，可以先帮您解答", "是", ""]),
    .data(27, ["加个微信", "", "稍后加您微信，您留意通过一下，再见", "", "是"]),
    .data(28, ["不需要", "", "好的，那不打扰您了，再见", "", "是"]),
    .gap,
  ]
}

struct MiniColumn {
  let letter: String
  let width: CGFloat
  init(_ letter: String, _ width: CGFloat) { self.letter = letter; self.width = width }
}

enum MiniRow {
  case section(Int, String)
  case header(Int, [String])
  case data(Int, [String])
  case gap

  var isBody: Bool {
    switch self {
    case .data, .gap: true
    case .section, .header: false
    }
  }
}

/// A small drawn spreadsheet. Columns to fill are tinted and outlined, everything else is dimmed.
struct MiniSheet: View {
  let columns: [MiniColumn]
  let rows: [MiniRow]
  var lit: Set<String> = []
  var handle: (row: Int, column: String)?
  var tag: String?

  private static let letterHeight: CGFloat = 24
  private static let rowHeight: CGFloat = 32
  private static let gapHeight: CGFloat = 22
  private static let numberWidth: CGFloat = 32

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 0) {
        Color.primary.opacity(0.04).frame(width: Self.numberWidth, height: Self.letterHeight)
          .overlay(alignment: .trailing) { gridLine(vertical: true) }
        ForEach(columns, id: \.letter) { column in
          let isLit = lit.contains(column.letter)
          Text(column.letter)
            .font(.system(size: 12, weight: isLit ? .bold : .regular))
            .foregroundStyle(isLit ? Color.accentColor : .secondary)
            .frame(width: column.width, height: Self.letterHeight)
            .background(isLit ? Color.accentColor.opacity(0.16) : Color.primary.opacity(0.04))
            .overlay(alignment: .trailing) { gridLine(vertical: true) }
        }
      }
      .overlay(alignment: .bottom) { gridLine(vertical: false) }
      ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
        rowView(row).overlay(alignment: .bottom) { gridLine(vertical: false) }
      }
    }
    .font(.system(size: 12.5))
    .background(Color.primary.opacity(0.035))
    .overlay(alignment: .topLeading) { outline }
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    .overlay(alignment: .topLeading) { tagView }
    .fixedSize()
  }

  private var litFrame: (x: CGFloat, width: CGFloat)? {
    guard let first = columns.firstIndex(where: { lit.contains($0.letter) }),
          let last = columns.lastIndex(where: { lit.contains($0.letter) }) else { return nil }
    let x = Self.numberWidth + columns[..<first].reduce(0) { $0 + $1.width }
    return (x, columns[first...last].reduce(0) { $0 + $1.width })
  }

  /// Vertical spans of consecutive data rows, so each pasted block gets its own outline.
  private var bodyRuns: [(y: CGFloat, height: CGFloat)] {
    var runs: [(y: CGFloat, height: CGFloat)] = []
    var y = Self.letterHeight
    var start: CGFloat?
    for row in rows {
      let height = { if case .gap = row { Self.gapHeight } else { Self.rowHeight } }()
      if row.isBody { start = start ?? y } else if let open = start { runs.append((open, y - open)); start = nil }
      y += height
    }
    if let open = start { runs.append((open, y - open)) }
    return runs
  }

  @ViewBuilder private var outline: some View {
    if let frame = litFrame {
      ForEach(Array(bodyRuns.enumerated()), id: \.offset) { _, run in
        RoundedRectangle(cornerRadius: 3, style: .continuous)
          .strokeBorder(Color.accentColor, lineWidth: 1.5)
          .frame(width: frame.width, height: run.height)
          .offset(x: frame.x, y: run.y)
      }
    }
  }

  @ViewBuilder private var tagView: some View {
    if let tag, let frame = litFrame, let run = bodyRuns.last {
      Text(tag)
        .font(.system(size: 11.5, weight: .semibold))
        .foregroundStyle(.white)
        .padding(.horizontal, 9)
        .padding(.vertical, 3)
        .background(Capsule().fill(Color.accentColor))
        .fixedSize()
        .frame(width: frame.width, alignment: .trailing)
        .offset(x: frame.x - 8, y: run.y + run.height - 11)
    }
  }

  @ViewBuilder private func rowView(_ row: MiniRow) -> some View {
    switch row {
    case .section(let number, let title):
      HStack(spacing: 0) {
        numberCell(number)
        Text(title).fontWeight(.semibold).foregroundStyle(.secondary).padding(.horizontal, 10)
          .frame(width: columns.reduce(0) { $0 + $1.width }, height: Self.rowHeight, alignment: .leading)
      }
    case .header(let number, let cells):
      HStack(spacing: 0) {
        numberCell(number)
        ForEach(Array(columns.enumerated()), id: \.offset) { index, column in
          let isLit = lit.contains(column.letter)
          cell(cells[safe: index] ?? "", column: column)
            .fontWeight(.semibold)
            .foregroundStyle(isLit ? Color.accentColor : .secondary)
            .background(isLit ? Color.accentColor.opacity(0.08) : Color.primary.opacity(0.025))
        }
      }
    case .data(let number, let cells):
      HStack(spacing: 0) {
        numberCell(number)
        ForEach(Array(columns.enumerated()), id: \.offset) { index, column in
          let text = cells[safe: index] ?? ""
          let isLit = lit.contains(column.letter)
          cell(text, column: column)
            .fontWeight(text == "是" ? .bold : isLit ? .medium : .regular)
            .foregroundStyle(text == "是" ? AnyShapeStyle(Color.accentColor) : isLit ? AnyShapeStyle(.primary) : AnyShapeStyle(.tertiary))
            .background(isLit ? Color.accentColor.opacity(0.14) : .clear)
            .overlay(alignment: .bottomTrailing) {
              if let handle, handle.row == number, handle.column == column.letter { fillHandle }
            }
        }
      }
    case .gap:
      HStack(spacing: 0) {
        Text("⋮").foregroundStyle(.tertiary).frame(width: Self.numberWidth, height: Self.gapHeight)
        ForEach(columns, id: \.letter) { column in
          let isLit = lit.contains(column.letter)
          Group {
            if handle?.column == column.letter {
              Label("往下拉", systemImage: "arrow.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(Color.accentColor)
                .fixedSize()
            } else {
              Text(isLit ? "⋮" : "").foregroundStyle(Color.accentColor.opacity(0.7))
            }
          }
          .frame(width: column.width, height: Self.gapHeight)
          .background(isLit ? Color.accentColor.opacity(0.07) : .clear)
        }
      }
    }
  }

  private func numberCell(_ number: Int) -> some View {
    Text("\(number)").font(.system(size: 11).monospacedDigit()).foregroundStyle(.secondary)
      .frame(width: Self.numberWidth, height: Self.rowHeight)
      .background(Color.primary.opacity(0.04))
      .overlay(alignment: .trailing) { gridLine(vertical: true) }
  }

  private func cell(_ text: String, column: MiniColumn) -> some View {
    Text(text)
      .lineLimit(1)
      .truncationMode(.tail)
      .padding(.horizontal, 8)
      .frame(width: column.width, height: Self.rowHeight, alignment: text == "是" || column.letter == "D" ? .center : .leading)
      .overlay(alignment: .trailing) { gridLine(vertical: true) }
  }

  private var fillHandle: some View {
    Rectangle().fill(Color.accentColor).frame(width: 8, height: 8)
      .overlay(Rectangle().stroke(Color(nsColor: .windowBackgroundColor), lineWidth: 1))
      .padding(2)
  }

  private func gridLine(vertical: Bool) -> some View {
    Rectangle().fill(Color.primary.opacity(0.07))
      .frame(width: vertical ? 0.5 : nil, height: vertical ? nil : 0.5)
  }
}

/// Page one: a faded sheet with the workbook's two tabs underneath, the one to fill highlighted.
struct SheetTabsPicture: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      MiniSheet(
        columns: [MiniColumn("A", 124), MiniColumn("B", 166), MiniColumn("C", 166), MiniColumn("D", 168)],
        rows: [
          .section(1, "主流程｜固定 13 条"),
          .header(2, ["流程模块", "情景（场景说明）", "示例（仅供参考）", "录音编号"]),
          .data(3, ["开场白", "一开始打电话时…", "喂，您好！", "1"]),
          .data(4, ["产品介绍", "给客户介绍产品…", "我们专门帮企业…", "2"]),
          .gap,
        ]
      )
      .opacity(0.6)
      HStack(spacing: 3) {
        tab("话术建议", selected: false)
        tab("话术内容", selected: true)
        Label("点这里", systemImage: "arrow.left").font(.system(size: 13, weight: .semibold)).foregroundStyle(Color.accentColor).padding(.leading, 12)
      }
      .padding(.top, 10)
      .padding(.leading, 32)
    }
    .fixedSize()
  }

  private func tab(_ title: String, selected: Bool) -> some View {
    Text(title)
      .font(.system(size: 13, weight: selected ? .semibold : .regular))
      .foregroundStyle(selected ? Color.white : .secondary)
      .padding(.horizontal, 16)
      .padding(.vertical, 7)
      .background(
        RoundedRectangle(cornerRadius: 7, style: .continuous)
          .fill(selected ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(Color.secondary.opacity(0.1)))
      )
  }
}

private extension Array {
  subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
