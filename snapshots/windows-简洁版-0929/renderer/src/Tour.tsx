import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export type TourPage = "import" | "checkup" | "intent" | "upload";

export interface TourStep {
  page: TourPage;
  target: string;
  title: string;
  body: string;
}

export const TOUR_KEY = "tungee.tour.v1";

export const tourSteps: TourStep[] = [
  { page: "import", target: "steps", title: "欢迎使用", body: "左边是四个步骤，从上往下做。下面用一份示例数据演示，不会改动你的文件。" },
  { page: "import", target: "files", title: "导入", body: "选取话术表格和录音文件夹，也可以直接拖进窗口。没有表格就先下载模板。" },
  { page: "import", target: "primary", title: "检查数据", body: "填好话术名称后点这里，自动检查表格并给录音配对。" },
  { page: "checkup", target: "checks", title: "体检", body: "确认录音配对、修正话术问题。修正会另存为新文件，原文件不变。" },
  { page: "intent", target: "intent", title: "意向", body: "按知识库问题生成意向建议。确认后，上传时只新建，不改已有意向。" },
  { page: "upload", target: "progress", title: "上传", body: "上传会打开 Chrome。登录探迹后点“已登录，继续”，之后自动填写，随时可以停止。" },
  { page: "upload", target: "pane", title: "本机 AI", body: "录音识别、体检和意向建议都在本机运行，不联网。右上角按钮可以收起这一栏。" },
  { page: "upload", target: "settings", title: "设置", body: "想再看一遍，在这里点“重新学习引导”。" },
];

interface Rect { left: number; top: number; width: number; height: number }

const CARD_WIDTH = 300;
const GAP = 14;
const PAD = 6;

function measure(target: string): Rect | null {
  const nodes = [...document.querySelectorAll<HTMLElement>(`[data-tour~="${target}"]`)];
  const rects = nodes.map((node) => node.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0);
  if (!rects.length) return null;
  const left = Math.min(...rects.map((rect) => rect.left)) - PAD;
  const top = Math.min(...rects.map((rect) => rect.top)) - PAD;
  const right = Math.max(...rects.map((rect) => rect.right)) + PAD;
  const bottom = Math.max(...rects.map((rect) => rect.bottom)) + PAD;
  return { left, top, width: right - left, height: bottom - top };
}

function place(rect: Rect | null, cardHeight: number): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!rect) return { left: (vw - CARD_WIDTH) / 2, top: (vh - cardHeight) / 2 };
  const clampTop = (top: number) => Math.min(Math.max(12, top), vh - cardHeight - 12);
  const clampLeft = (left: number) => Math.min(Math.max(12, left), vw - CARD_WIDTH - 12);
  if (rect.left + rect.width + GAP + CARD_WIDTH < vw - 12) return { left: rect.left + rect.width + GAP, top: clampTop(rect.top) };
  if (rect.left - GAP - CARD_WIDTH > 12) return { left: rect.left - GAP - CARD_WIDTH, top: clampTop(rect.top) };
  if (rect.top + rect.height + GAP + cardHeight < vh - 12) return { left: clampLeft(rect.left), top: rect.top + rect.height + GAP };
  return { left: clampLeft(rect.left), top: clampTop(rect.top - GAP - cardHeight) };
}

export function Tour({ onPage, onClose }: { onPage: (page: TourPage) => void; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [card, setCard] = useState<HTMLDivElement | null>(null);
  const [cardHeight, setCardHeight] = useState(150);
  const step = tourSteps[index] ?? tourSteps[0]!;
  const last = index === tourSteps.length - 1;

  const refresh = useCallback(() => setRect(measure(step.target)), [step.target]);

  useEffect(() => { onPage(step.page); }, [step.page, onPage]);

  useLayoutEffect(() => {
    refresh();
    const timers = [60, 200, 500].map((delay) => window.setTimeout(refresh, delay));
    window.addEventListener("resize", refresh);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", refresh);
    };
  }, [refresh]);

  useLayoutEffect(() => {
    if (card) setCardHeight(card.offsetHeight);
  }, [card, index]);

  const next = useCallback(() => (last ? onClose() : setIndex((value) => value + 1)), [last, onClose]);
  const back = useCallback(() => setIndex((value) => Math.max(0, value - 1)), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight" || event.key === "Enter") next();
      else if (event.key === "ArrowLeft") back();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, onClose]);

  const position = place(rect, cardHeight);

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className={`tour-spot ${rect ? "" : "is-hidden"}`} style={rect ?? undefined} />
      <div className="tour-card" ref={setCard} key={index} style={{ left: position.left, top: position.top, width: CARD_WIDTH }}>
        <small>{index + 1} / {tourSteps.length}</small>
        <h3 id="tour-title">{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-foot">
          {last ? <span /> : <button className="button subtle" onClick={onClose}>跳过</button>}
          <div>
            {index > 0 && <button className="button" onClick={back}>上一步</button>}
            <button className="button primary" onClick={next}>{last ? "开始使用" : "下一步"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
