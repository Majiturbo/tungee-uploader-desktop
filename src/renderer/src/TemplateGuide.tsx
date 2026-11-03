import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, AudioWaveform, CircleMinus, FileSearch, Hand, Lightbulb, ListOrdered, PhoneOff, Stethoscope, Trash2, TriangleAlert, type LucideIcon } from "lucide-react";
import { set } from "./model";
import { Button, SegmentedTabs, Sheet } from "./ui";

// Four illustrated pages on filling the standard template. The tables are drawn, not screenshots,
// so they look the same for Excel and WPS users and follow dark mode.

type Column = [letter: string, width: number];
type Row =
  | { kind: "section"; number: number; title: string }
  | { kind: "header"; number: number; cells: string[] }
  | { kind: "data"; number: number; cells: string[] }
  | { kind: "gap" };

const section = (number: number, title: string): Row => ({ kind: "section", number, title });
const header = (number: number, cells: string[]): Row => ({ kind: "header", number, cells });
const data = (number: number, cells: string[]): Row => ({ kind: "data", number, cells });
const gap: Row = { kind: "gap" };

const LETTER_HEIGHT = 24;
const ROW_HEIGHT = 32;
const GAP_HEIGHT = 22;
const NUMBER_WIDTH = 32;

const isBody = (row: Row) => row.kind === "data" || row.kind === "gap";

/** A small drawn spreadsheet. Columns to fill are tinted and outlined, everything else is dimmed. */
function MiniSheet({ columns, rows, lit = [], handle, tag, dim }: {
  columns: Column[];
  rows: Row[];
  lit?: string[];
  handle?: [row: number, column: string];
  tag?: string;
  dim?: boolean;
}) {
  const isLit = (letter: string) => lit.includes(letter);
  const first = columns.findIndex(([letter]) => isLit(letter));
  const last = columns.map(([letter]) => isLit(letter)).lastIndexOf(true);
  const litFrame = first >= 0
    ? { x: NUMBER_WIDTH + columns.slice(0, first).reduce((sum, [, width]) => sum + width, 0), width: columns.slice(first, last + 1).reduce((sum, [, width]) => sum + width, 0) }
    : null;
  const runs: Array<{ y: number; height: number }> = [];
  let y = LETTER_HEIGHT;
  let start: number | null = null;
  for (const row of rows) {
    const height = row.kind === "gap" ? GAP_HEIGHT : ROW_HEIGHT;
    if (isBody(row)) start ??= y;
    else if (start !== null) {
      runs.push({ y: start, height: y - start });
      start = null;
    }
    y += height;
  }
  if (start !== null) runs.push({ y: start, height: y - start });
  const totalWidth = columns.reduce((sum, [, width]) => sum + width, 0);

  const numberCell = (number: number | string, height = ROW_HEIGHT) => (
    <span className="mini-num" style={{ width: NUMBER_WIDTH, height }}>{number}</span>
  );

  const rowView = (row: Row, index: number): ReactNode => {
    switch (row.kind) {
      case "section":
        return (
          <div key={index} className="mini-row">
            {numberCell(row.number)}
            <span className="mini-cell" style={{ width: totalWidth, fontWeight: 600, color: "var(--text-2)", paddingLeft: 10 }}>{row.title}</span>
          </div>
        );
      case "header":
        return (
          <div key={index} className="mini-row">
            {numberCell(row.number)}
            {columns.map(([letter, width], column) => (
              <span key={letter} className={`mini-cell is-line${isLit(letter) ? " is-lit-header" : " is-header"}`}
                style={{ width, justifyContent: letter === "D" ? "center" : undefined }}>{row.cells[column] ?? ""}</span>
            ))}
          </div>
        );
      case "data":
        return (
          <div key={index} className="mini-row">
            {numberCell(row.number)}
            {columns.map(([letter, width], column) => {
              const text = row.cells[column] ?? "";
              const yes = text === "是";
              return (
                <span key={letter} className={`mini-cell is-line${isLit(letter) ? " is-lit" : ""}`}
                  style={{
                    width,
                    justifyContent: yes || letter === "D" ? "center" : undefined,
                    fontWeight: yes ? 700 : isLit(letter) ? 500 : 400,
                    color: yes ? "var(--blue)" : isLit(letter) ? "var(--text)" : "var(--text-3)",
                  }}>
                  <span className="ellipsis">{text}</span>
                  {handle && handle[0] === row.number && handle[1] === letter && <i className="mini-handle" />}
                </span>
              );
            })}
          </div>
        );
      case "gap":
        return (
          <div key={index} className="mini-row">
            {numberCell("⋮", GAP_HEIGHT)}
            {columns.map(([letter, width]) => (
              <span key={letter} className="mini-cell" style={{ width, height: GAP_HEIGHT, justifyContent: "center",
                background: isLit(letter) ? "color-mix(in srgb, var(--blue) 7%, transparent)" : undefined,
                color: "color-mix(in srgb, var(--blue) 70%, transparent)" }}>
                {handle?.[1] === letter
                  ? <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, color: "var(--blue)", whiteSpace: "nowrap" }}><ArrowDown size={11} strokeWidth={2.4} />往下拉</span>
                  : isLit(letter) ? "⋮" : ""}
              </span>
            ))}
          </div>
        );
    }
  };

  return (
    <div className="mini" style={{ width: NUMBER_WIDTH + totalWidth, opacity: dim ? 0.6 : 1 }}>
      <div className="mini-sheet">
        <div className="mini-row">
          <span className="mini-num" style={{ width: NUMBER_WIDTH, height: LETTER_HEIGHT }} />
          {columns.map(([letter, width]) => (
            <span key={letter} className={`mini-letter${isLit(letter) ? " is-lit" : ""}`} style={{ width }}>{letter}</span>
          ))}
        </div>
        {rows.map(rowView)}
        {litFrame && runs.map((run, index) => (
          <i key={index} className="mini-outline" style={{ left: litFrame.x, top: run.y, width: litFrame.width, height: run.height }} />
        ))}
      </div>
      {tag && litFrame && runs.length > 0 && (
        <span className="mini-tag" style={{ left: litFrame.x, width: litFrame.width - 8, top: runs.at(-1)!.y + runs.at(-1)!.height - 11 }}>
          <b>{tag}</b>
        </span>
      )}
    </div>
  );
}

/** Page one: a faded sheet with the workbook's two tabs underneath, the one to fill highlighted. */
function SheetTabsPicture() {
  return (
    <div>
      <MiniSheet dim columns={[["A", 124], ["B", 166], ["C", 166], ["D", 168]]} rows={[
        section(1, "主流程｜固定 13 条"),
        header(2, ["流程模块", "情景（场景说明）", "示例（仅供参考）", "录音编号"]),
        data(3, ["开场白", "一开始打电话时…", "喂，您好！", "1"]),
        data(4, ["产品介绍", "给客户介绍产品…", "我们专门帮企业…", "2"]),
        gap,
      ]} />
      <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "10px 0 0 32px" }}>
        <span className="mini-tab">话术建议</span>
        <span className="mini-tab is-selected">话术内容</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, paddingLeft: 12, fontWeight: 600, color: "var(--blue)" }}>
          <ArrowLeft size={14} strokeWidth={2.2} />点这里
        </span>
      </div>
    </div>
  );
}

interface Point {
  icon: LucideIcon;
  text: string;
  tint?: string;
}

interface GuidePage {
  tab: string;
  title: string;
  body: string;
  picture: ReactNode;
  points: Point[];
}

const PAGES: GuidePage[] = [
  {
    tab: "打开工作表",
    title: "打开「话术内容」工作表",
    body: "模板里有两个工作表，要填的是「话术内容」这一张。",
    picture: <SheetTabsPicture />,
    points: [
      { icon: Lightbulb, text: "「话术建议」里是推荐加上的问答和更全的问法，可以挑着复制到知识库" },
      { icon: TriangleAlert, text: "只往格子里填内容，不要增删列、改表头，否则检查不过", tint: "var(--orange)" },
    ],
  },
  {
    tab: "主流程",
    title: "主流程和含糊话术：粘贴进 E 列",
    body: "第 3–15 行是主流程，第 18–21 行是含糊话术。把你的话术直接粘贴进「客户话术填写列」。",
    picture: <MiniSheet lit={["E"]} tag="粘贴到这里" columns={[["A", 98], ["B", 120], ["C", 124], ["D", 68], ["E", 214]]} rows={[
      section(1, "主流程｜固定 13 条"),
      header(2, ["流程模块", "情景（场景说明）", "示例（仅供参考）", "录音编号", "客户话术填写列"]),
      data(3, ["开场白", "一开始打电话时…", "喂，您好！", "1", "您好，我是示例公司的小李"]),
      gap,
      data(15, ["结束话语04", "用户无回复时…", "不好意思，我这边…", "13", "那先不打扰您了，再见"]),
      section(16, "含糊话术"),
      header(17, ["流程模块", "情景（场景说明）", "示例（仅供参考）", "录音编号", "客户话术填写列"]),
      data(18, ["含糊话术01", "环境吵杂听不清…", "不好意思，听的不…", "14", "抱歉，刚才没听清"]),
      gap,
      data(21, ["含糊话术04", "客户说听不清时…", "现在可以听到吗?", "17", "现在能听清吗"]),
    ]} />,
    points: [
      { icon: AudioWaveform, text: "每行对应一条录音，会听录音内容自动配上，文件名随意" },
      { icon: Hand, text: "A–D 列是模板自带的说明和编号，不用改" },
    ],
  },
  {
    tab: "知识库",
    title: "知识库：从第 25 行起覆盖 A–E 列",
    body: "把整理好的问题、问法、回答按列对齐，从第 25 行开始粘贴，盖掉模板里的示例。",
    picture: <MiniSheet lit={["A", "B", "C", "D", "E"]} handle={[28, "D"]} tag="粘贴覆盖" columns={[["A", 94], ["B", 156], ["C", 90], ["D", 56], ["E", 228]]} rows={[
      section(23, "知识库｜数量可增减"),
      header(24, ["问题", "问法", "回答示例", "编号", "客户话术填写列"]),
      data(25, ["价格多少", "多少钱；怎么收费", "…", "18", "我们按年收费，具体看门店…"]),
      data(26, ["公司在哪", "你们在哪；地址在哪", "…", "19", "我们在市中心，稍后发您定位"]),
      data(27, ["加个微信", "加微信；有微信吗", "…", "20", "好的，稍后加您微信"]),
      data(28, ["不需要", "不用了；没兴趣", "…", "21", "好的，那不打扰您了，再见"]),
      gap,
    ]} />,
    points: [
      { icon: ListOrdered, text: "编号改成连续序号：D25、D26 填 18、19，选中这两格，拖右下角的小方块往下拉" },
      { icon: FileSearch, text: "录音文件名不用对上编号，会听内容自动配" },
      { icon: Trash2, text: "模板示例比你的问题多时，多出来的行整行删掉" },
    ],
  },
  {
    tab: "无效QA / 特殊QA",
    title: "无效QA 和特殊QA：需要的填「是」",
    body: "也是从第 25 行起，只在需要的行填「是」，其余留空。",
    picture: <MiniSheet lit={["F", "G"]} tag="需要的填「是」" columns={[["A", 118], ["…", 32], ["E", 258], ["F", 108], ["G", 108]]} rows={[
      header(24, ["问题", "", "客户话术填写列", "无效QA", "特殊QA"]),
      data(25, ["价格多少", "", "我们按年收费，具体看门店…", "", ""]),
      data(26, ["是不是机器人", "", "我是智能助理，可以先帮您解答", "是", ""]),
      data(27, ["加个微信", "", "稍后加您微信，您留意通过一下，再见", "", "是"]),
      data(28, ["不需要", "", "好的，那不打扰您了，再见", "", "是"]),
      gap,
    ]} />,
    points: [
      { icon: CircleMinus, text: "无效QA：命中后不计入意向，比如问是不是机器人、说打错了" },
      { icon: PhoneOff, text: "特殊QA：命中后立即挂断，回答以「再见」「拜拜」这类结束语收尾的就该设；这类回答别用问句结尾" },
      { icon: Stethoscope, text: "拿不准也没关系，体检会建议哪些行该设" },
    ],
  },
];

export function TemplateGuideSheet({ initialPage = 0 }: { initialPage?: number }) {
  const [page, setPage] = useState(Math.min(Math.max(initialPage, 0), PAGES.length - 1));
  const current = PAGES[page]!;
  const last = page === PAGES.length - 1;
  const close = () => set({ templateGuideOpen: false });
  return (
    <Sheet width={720} height={680} onClose={close}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "28px 32px 8px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <h2 className="serif" style={{ margin: 0, fontSize: 30, lineHeight: 1.2 }}>怎么填模板</h2>
          <span className="secondary">四步填好 · Excel、WPS 里操作都一样</span>
        </div>
        <SegmentedTabs items={PAGES.map((item, index) => ({ value: String(index), title: item.tab }))} value={String(page)} onChange={(value) => setPage(Number(value))} />
      </div>
      <div className="sheet-body" key={page} style={{ padding: "16px 32px", animation: "page-in 0.3s ease" }}>
        <div className="title3 strong">{current.title}</div>
        <div className="secondary" style={{ paddingTop: 4 }}>{current.body}</div>
        <div style={{ paddingTop: 16 }}>{current.picture}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 20 }}>
          {current.points.map((point) => (
            <div key={point.text} style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <point.icon size={14} strokeWidth={1.9} color={point.tint ?? "var(--blue)"} style={{ width: 20, flex: "none", alignSelf: "center" }} />
              <span>{point.text}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="sheet-foot" style={{ padding: "16px 32px" }}>
        <span className="secondary" style={{ flex: 1 }}>第 {page + 1} 步，共 {PAGES.length} 步</span>
        {page > 0 && <Button onClick={() => setPage(page - 1)}>上一步</Button>}
        <Button prominent onClick={() => (last ? close() : setPage(page + 1))}>{last ? "知道了" : "下一步"}</Button>
      </div>
    </Sheet>
  );
}
