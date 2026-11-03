import { useEffect, useRef, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { ChevronRight } from "lucide-react";
import type { AudioMatchItem, PreviewSummary } from "../../shared/types";
import { DotCard, useDotCard } from "./DotCard";
import { sections } from "./model";

export type DotState = "matched" | "converted" | "missing" | "review" | "pending" | "active" | "done";

export function RecordingDot({ state, size = 11, title, index, className, ...events }: {
  state: DotState;
  size?: number;
  title?: string;
  index?: number;
  className?: string;
  ref?: Ref<HTMLSpanElement>;
} & Omit<HTMLAttributes<HTMLSpanElement>, "className" | "title">) {
  return (
    <span className={`dot is-${state}${className ? ` ${className}` : ""}`} title={title} {...events}
      style={{ width: size, height: size, ...(index !== undefined ? { ["--i" as string]: index } : {}) }}>
      {state === "matched" && (
        <svg viewBox="0 0 11 11" aria-hidden>
          <path d="M3.1 5.7l1.6 1.6 3.2-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

export const DEFAULT_LEGEND: Array<[DotState, string]> = [["matched", "已配对"], ["converted", "上传前处理"], ["missing", "缺录音"]];

const STATE_LABELS: Record<DotState, string> = {
  matched: "已配对", converted: "上传前处理", missing: "缺录音", review: "没把握", pending: "等待", active: "正在传", done: "已上传",
};

function flowNodes(items: AudioMatchItem[]): Array<{ name: string; items: AudioMatchItem[] }> {
  const groups = new Map<string, AudioMatchItem[]>();
  for (const item of items) {
    const name = (item.label.split("-")[0] ?? item.label).replace(/\d+$/, "");
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  return [...groups].map(([name, grouped]) => ({ name, items: grouped }));
}

function Node({ title, count, children, help }: { title: string; count: number; children: ReactNode; help?: string }) {
  return (
    <div className="node" title={help}>
      <div className="node-title">{title}<span>{count}</span></div>
      <div className="node-dots">{children}</div>
    </div>
  );
}

/** Main flow as a row of nodes, vague answers and knowledge base underneath. Each dot is one recording. */
export function RecordingMap({ summary, state, legend = DEFAULT_LEGEND }: {
  summary: PreviewSummary;
  state: (item: AudioMatchItem) => DotState;
  legend?: Array<[DotState, string]>;
}) {
  const parts = sections(summary);
  const nodes = flowNodes(parts.flow);
  const card = useDotCard();
  const dots = (items: AudioMatchItem[], start: number) => items.map((item, offset) => (
    <RecordingDot key={item.audioNumber} state={state(item)} index={start + offset}
      className={card.open?.number === item.audioNumber ? "is-open" : undefined}
      ref={(element: HTMLSpanElement | null) => {
        if (element) card.dots.set(item.audioNumber, element);
        else card.dots.delete(item.audioNumber);
      }}
      role="button" aria-label={`${item.audioNumber} 号 · ${item.label}`}
      onMouseEnter={() => card.hover(item.audioNumber, true)}
      onMouseLeave={() => card.hover(item.audioNumber, false)}
      onClick={() => card.tap(item.audioNumber)} />
  ));
  const label = (dot: DotState) => legend.find(([entry]) => entry === dot)?.[1] ?? STATE_LABELS[dot];
  const section = (item: AudioMatchItem) => {
    if (parts.vague.includes(item)) return "含糊话术";
    if (parts.knowledge.includes(item)) return "知识库";
    const node = nodes.find((entry) => entry.items.includes(item));
    return node ? `主流程 · ${node.name}` : "主流程";
  };
  const cardProps = { control: card, summary, state, stateLabel: label, section };
  let start = 0;
  return (
    <section className="map" data-tour="map">
      <div className="map-head">
        <span className="section-title">话术结构</span>
        <span className="legend">
          {legend.map(([dot, label]) => <span key={label}><RecordingDot state={dot} />{label}</span>)}
        </span>
      </div>
      <div className="map-flow">
        <span className="callout secondary">主流程</span>
        <div className="map-flow-row">
          {nodes.map((node, index) => {
            const offset = start;
            start += node.items.length;
            return (
              <FlowStep key={node.name} first={index === 0}>
                <Node title={node.name} count={node.items.length}>{dots(node.items, offset)}</Node>
              </FlowStep>
            );
          })}
        </div>
      </div>
      <div className="map-lower">
        <Node title="含糊话术" count={parts.vague.length} help="听不清或答非所问时兜底">{dots(parts.vague, parts.flow.length)}</Node>
        <Node title="知识库" count={parts.knowledge.length} help="客户提问时回答">{dots(parts.knowledge, parts.flow.length + parts.vague.length)}</Node>
      </div>
      {card.leaving && <DotCard key={`leaving-${card.leaving.session}`} card={card.leaving} leaving {...cardProps} />}
      {card.open && <DotCard key={card.open.session} card={card.open} {...cardProps} />}
    </section>
  );
}

function FlowStep({ first, children }: { first: boolean; children: ReactNode }) {
  return (
    <>
      {!first && <span className="map-chevron"><ChevronRight size={12} strokeWidth={2.6} /></span>}
      {children}
    </>
  );
}

/** A row in "需要你看一眼": tinted glyph, title, detail, optional trailing action. */
export function AttentionRow({ icon, title, detail, action, run, tour, disabled }: {
  icon: ReactNode;
  title: string;
  detail?: string;
  action?: string;
  run?: () => void;
  tour?: string;
  disabled?: boolean;
}) {
  return (
    <div className="attention-row" data-tour={tour}>
      <span className="glyph">{icon}</span>
      <div className="text">
        <b>{title}</b>
        {detail && <span>{detail}</span>}
      </div>
      {action && run && <button className="btn" onClick={run} disabled={disabled}>{action}</button>}
    </div>
  );
}

// MARK: Ambient light

export type Mood = "calm" | "attention" | "error" | "done";

export const MOOD_COLORS: Record<Mood, [string, string, string]> = {
  calm: ["--blue", "--orange", "--cyan"],
  attention: ["--orange", "--red", "--pink"],
  error: ["--red", "--pink", "--red"],
  done: ["--blue", "--green", "--mint"],
};

/** Size and resting spot of each glow as fractions of the page width, left to right. */
const GLOWS: Array<{ size: number; x: number; y: number }> = [{ size: 0.62, x: 0.085, y: -70 }, { size: 0.55, x: 0.39, y: -120 }, { size: 0.5, x: 0.7, y: 60 }];
const GUST_EVERY = 13;
/** How long the gust takes to reach each next glow. */
const GUST_TRAVEL = 0.7;

/** `lift` swells from 0 to 1 and back over the first half of each cycle; `flutter` is the ripple riding on it. */
function gust(t: number): { lift: number; flutter: number } {
  const p = (t / GUST_EVERY) % 1;
  const q = p < 0 ? p + 1 : p;
  if (q >= 0.55) return { lift: 0, flutter: 0 };
  const lift = Math.sin((Math.PI * q) / 0.55) ** 2;
  return { lift, flutter: lift * Math.sin(2 * Math.PI * q * 3) };
}

/** Soft light at the top of the page whose hue reflects the current state. The glows move as one sheet, like a
 * silk scarf: every so often a gust sweeps across from the left, lifting it down and to the right before it
 * settles again, with a faint sway in between. Blurred once as static gradients; only transforms animate. */
export function AmbientLight({ mood }: { mood: Mood }) {
  const sheet = useRef<HTMLDivElement>(null);
  const glows = useRef<Array<HTMLDivElement | null>>([]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const layout = (t: number) => {
      const width = box.current?.clientWidth ?? 0;
      if (sheet.current) {
        sheet.current.style.transform = `translateX(${10 * Math.sin((2 * Math.PI * t) / 23)}px) scaleY(${1 + 0.04 * Math.sin((2 * Math.PI * t) / 17)})`;
      }
      GLOWS.forEach((spot, index) => {
        const element = glows.current[index];
        if (!element) return;
        const g = gust(t - index * GUST_TRAVEL);
        const size = width * spot.size;
        element.style.width = `${size}px`;
        element.style.height = `${size * 0.6}px`;
        element.style.transform = `translate(${width * spot.x + 40 * g.lift + 10 * g.flutter}px, ${spot.y + 22 * g.lift}px) scale(${1 + 0.04 * g.lift}, ${1 + 0.1 * g.lift + 0.03 * g.flutter})`;
      });
    };
    const tick = () => {
      frame = requestAnimationFrame(tick);
      layout(((Date.now() / 1000) % 36000));
    };
    const run = () => {
      cancelAnimationFrame(frame);
      if (reduce.matches) layout(0);
      else frame = requestAnimationFrame(tick);
    };
    run();
    const resize = new ResizeObserver(() => reduce.matches && layout(0));
    if (box.current) resize.observe(box.current);
    reduce.addEventListener("change", run);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      reduce.removeEventListener("change", run);
    };
  }, []);

  const colors = MOOD_COLORS[mood];
  return (
    <div ref={box} className="ambient" aria-hidden>
      <div ref={sheet} className="ambient-sheet">
        {GLOWS.map((_, index) => (
          <div key={index} ref={(element) => { glows.current[index] = element; }} className="ambient-glow"
            style={{ ["--glow" as string]: `var(${colors[index]})` }} />
        ))}
      </div>
    </div>
  );
}
