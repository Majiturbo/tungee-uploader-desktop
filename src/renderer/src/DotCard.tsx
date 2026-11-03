import { useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AudioMatchItem, PreviewSummary } from "../../shared/types";
import { BASIS_LABELS, PlayButton } from "./AudioMatchSheet";
import { changeDetails, changeSummary } from "./ModifyPages";
import { busy, get, isKnowledge, isModify, isTrimmed, set, trimNote, useModel } from "./model";
import { RecordingDot, type DotState } from "./Recordings";
import { Button } from "./ui";

const PEEK_WIDTH = 240;
const DETAIL_WIDTH = 360;
/** Height a detail card usually needs. The side is picked for this even while peeking, so expanding grows the peek in place. */
const DETAIL_ROOM = 380;

type Card = { number: number; session: number; expanded: boolean };

/** Which dot's card is showing and how big it is. A peek follows the pointer from dot to dot without
 * reopening; a click turns the peek into the detail card in place. */
export function useDotCard() {
  const [open, setOpen] = useState<Card | null>(null);
  const [leaving, setLeaving] = useState<Card | null>(null);
  const dots = useRef(new Map<number, HTMLElement>());
  const current = useRef<Card | null>(null);
  const session = useRef(0);
  const lastClosed = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const apply = (next: Card | null) => {
    current.current = next;
    setOpen(next);
  };

  const bounce = (number: number, closing: boolean) => {
    dots.current.get(number)?.animate(
      closing
        ? [{ transform: "scale(1.45)" }, { transform: "scale(0.8)", offset: 0.4 }, { transform: "scale(1)" }]
        : [{ transform: "scale(1.45)" }, { transform: "scale(1.85)", offset: 0.35 }, { transform: "scale(1.45)" }],
      { duration: 380, easing: "cubic-bezier(0.3, 1.4, 0.6, 1)" },
    );
  };

  const show = (number: number, expanded: boolean) => {
    if (current.current && current.current.number !== number) setLeaving(current.current);
    session.current += 1;
    apply({ number, session: session.current, expanded });
  };

  const close = () => {
    window.clearTimeout(timer.current);
    const card = current.current;
    if (!card) return;
    setLeaving(card);
    bounce(card.number, true);
    lastClosed.current = Date.now();
    apply(null);
  };

  const hover = (number: number, inside: boolean) => {
    window.clearTimeout(timer.current);
    const card = current.current;
    if (card?.expanded) return;
    if (inside) {
      if (card) apply({ ...card, number });
      else if (Date.now() - lastClosed.current < 500) show(number, false);
      else timer.current = window.setTimeout(() => show(number, false), 300);
    } else if (card?.number === number) {
      timer.current = window.setTimeout(() => {
        if (!current.current?.expanded && current.current?.number === number) close();
      }, 120);
    }
  };

  const tap = (number: number) => {
    window.clearTimeout(timer.current);
    const card = current.current;
    if (card?.expanded && card.number === number) return close();
    if (card && card.number === number) {
      apply({ ...card, expanded: true });
    } else {
      show(number, true);
    }
    bounce(number, false);
  };

  useEffect(() => {
    if (!open?.expanded) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element;
      if (target.closest(".dot-card") || dots.current.get(open.number)?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open?.expanded, open?.number]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { open, leaving, dots: dots.current, hover, tap, close, left: () => setLeaving(null) };
}

export type DotCardControl = ReturnType<typeof useDotCard>;

/** The floating card for one recording, drawn above the page and pointing at its dot. */
export function DotCard({ card, control, summary, state, stateLabel, section, leaving }: {
  card: Card;
  control: DotCardControl;
  summary: PreviewSummary;
  state: (item: AudioMatchItem) => DotState;
  stateLabel: (state: DotState) => string;
  section: (item: AudioMatchItem) => string;
  leaving?: boolean;
}) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const box = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLSpanElement>(null);
  const last = useRef<{ rect: DOMRect; arrow: number; expanded: boolean } | null>(null);
  const item = summary.audioMatch.items.find((entry) => entry.audioNumber === card.number);
  const dot = control.dots.get(card.number);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element || !arrow.current) return;
    const rect = element.getBoundingClientRect();
    const arrowLeft = arrow.current.offsetLeft;
    const previous = last.current;
    last.current = { rect, arrow: arrowLeft, expanded: card.expanded };
    if (!previous || previous.expanded === card.expanded || leaving) return;
    const timing = { duration: 300, easing: "cubic-bezier(0.3, 1.2, 0.6, 1)" };
    element.animate([
      { width: `${previous.rect.width}px`, height: `${previous.rect.height}px`, left: `${previous.rect.left}px` },
      { width: `${rect.width}px`, height: `${rect.height}px`, left: `${rect.left}px` },
    ], timing);
    arrow.current.animate([{ left: `${previous.arrow + previous.rect.left - rect.left}px` }, { left: `${arrowLeft}px` }], timing);
  });

  useEffect(() => {
    if (leaving) return;
    window.addEventListener("scroll", redraw, true);
    window.addEventListener("resize", redraw);
    return () => {
      window.removeEventListener("scroll", redraw, true);
      window.removeEventListener("resize", redraw);
    };
  }, [leaving]);

  if (!item || !dot) return null;
  const rect = dot.getBoundingClientRect();
  const width = card.expanded ? DETAIL_WIDTH : PEEK_WIDTH;
  const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, 12), window.innerWidth - width - 12);
  const arrowX = rect.left + rect.width / 2 - left;
  const need = DETAIL_ROOM + 16;
  const below = rect.bottom + need < window.innerHeight || (rect.top - need < 52 && window.innerHeight - rect.bottom > rect.top - 52);
  const dotState = state(item);
  const classes = ["dot-card", below ? "is-below" : "is-above", card.expanded && "is-expanded", leaving && "is-leaving"];

  return createPortal(
    <div ref={box} className={classes.filter(Boolean).join(" ")} role="dialog" aria-label={`${item.audioNumber} 号 · ${item.label}`}
      style={{
        left,
        width,
        ...(below ? { top: rect.bottom + 5 } : { bottom: window.innerHeight - rect.top + 5 }),
        transformOrigin: below ? `${arrowX}px ${-5 - rect.height / 2}px` : `${arrowX}px calc(100% + ${5 + rect.height / 2}px)`,
      }}
      onAnimationEnd={(event) => leaving && event.target === event.currentTarget && control.left()}>
      <span ref={arrow} className="dot-card-arrow" style={{ left: Math.min(Math.max(arrowX, 20), width - 20) - 7 }} />
      <div key={card.expanded ? "detail" : "peek"} className="dot-card-content">
        {card.expanded
          ? <DotDetail item={item} summary={summary} state={dotState} stateLabel={stateLabel(dotState)} section={section(item)} close={control.close} />
          : <DotPeek item={item} state={dotState} stateLabel={stateLabel(dotState)} section={section(item)} />}
      </div>
    </div>,
    document.body,
  );
}

function DotPeek({ item, state, stateLabel, section }: { item: AudioMatchItem; state: DotState; stateLabel: string; section: string }) {
  const s = useModel();
  const change = s.modifyPlan?.items.find((entry) => entry.audioNumber === item.audioNumber);
  const status = isModify(s)
    ? change ? changeSummary(change) || "不改" : item.fileName ? `${item.fileName} · ${stateLabel}` : "不换录音"
    : item.fileName ? `${item.fileName} · ${stateLabel}` : "没有录音";
  return (
    <div className="dot-peek">
      <div className="dot-card-head">
        <b className="ellipsis">{item.audioNumber} 号 · {item.label}</b>
        <span className="tertiary">{section.split(" · ")[0]}</span>
      </div>
      <span className="secondary clamp-2">{item.speech}</span>
      <span className="dot-card-status"><RecordingDot state={state} size={9} /><span className="ellipsis">{status}</span></span>
    </div>
  );
}

/** Playback with progress for the card: one clip at a time, stopped when the card goes away. */
function useClip(audioDir: string) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const frame = useRef(0);
  const stop = () => {
    cancelAnimationFrame(frame.current);
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
    setProgress(0);
  };
  const play = (file: string | null) => {
    stop();
    if (!file || get().saved) return;
    const element = new Audio(window.tungee.audioUrl(audioDir, file));
    element.onended = stop;
    audio.current = element;
    setPlaying(file);
    const tick = () => {
      if (element.duration > 0) setProgress(element.currentTime / element.duration);
      frame.current = requestAnimationFrame(tick);
    };
    element.play().then(tick).catch(stop);
  };
  useEffect(() => stop, []);
  return { playing, progress, play, stop };
}

function useDuration(audioDir: string, file: string | null): number | null {
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    setDuration(null);
    if (!file || get().saved) return;
    const element = new Audio();
    element.preload = "metadata";
    element.onloadedmetadata = () => setDuration(element.duration);
    element.src = window.tungee.audioUrl(audioDir, file);
    return () => {
      element.onloadedmetadata = null;
      element.src = "";
    };
  }, [audioDir, file]);
  return duration;
}

const clock = (seconds: number) => {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** The recording's shape, with the silence cut before uploading drawn faint and the played part in blue. */
function Waveform({ trim, progress }: { trim: NonNullable<AudioMatchItem["trim"]>; progress: number }) {
  const count = trim.wave.length;
  return (
    <span className="dot-card-wave" aria-hidden>
      {trim.wave.map((level, index) => {
        const at = ((index + 0.5) / count) * trim.duration;
        const cut = at < trim.head || at > trim.duration - trim.tail;
        const played = (index + 0.5) / count <= progress;
        return <i key={index} className={cut ? "is-cut" : played ? "is-played" : undefined} style={{ height: `${Math.max(14, level * 100)}%` }} />;
      })}
    </span>
  );
}

function DotDetail({ item, summary, state, stateLabel, section, close }: {
  item: AudioMatchItem;
  summary: PreviewSummary;
  state: DotState;
  stateLabel: string;
  section: string;
  close: () => void;
}) {
  const s = useModel();
  const modify = isModify(s);
  const audioDir = summary.audioMatch.audioDir;
  const clip = useClip(audioDir);
  const duration = useDuration(audioDir, item.fileName);
  const [showAll, setShowAll] = useState(false);
  const change = s.modifyPlan?.items.find((entry) => entry.audioNumber === item.audioNumber);
  const lines = modify && change ? changeDetails(change) : [];
  const transcript = item.fileName ? summary.audioMatch.files.find((file) => file.name === item.fileName)?.transcript : undefined;
  const basisLabel = BASIS_LABELS[item.basis] ?? item.basis;
  const pairing = item.basis === "confirmed" ? "人工确认的配对"
    : `按${basisLabel}配对${item.basis === "speech" && item.score > 0 ? `，相似度 ${Math.round(item.score * 100)}%` : ""}`;
  const trim = isTrimmed(summary, item) ? trimNote(item.trim) : null;
  const convert = summary.convertAudioNumbers.includes(item.audioNumber);
  const before = trim || convert ? `上传前${[trim, convert ? "转成 8k WAV" : null].filter(Boolean).join("，")}` : null;
  const tint = state === "missing" || state === "review" ? "orange" : state === "pending" ? "gray" : "blue";
  const playingMain = item.fileName !== null && clip.playing === item.fileName;

  return (
    <div className="dot-detail">
      <div className="dot-card-head">
        <div className="grow">
          <b>{item.audioNumber} 号 · {item.label}</b>
          <small className="secondary">{section}</small>
        </div>
        <span className={`dot-card-capsule is-${tint}`}>{stateLabel}</span>
      </div>
      <Block title="话术">
        <span className={showAll ? "selectable" : "selectable clamp-6"}>{item.speech}</span>
        {[...item.speech].length > 120 && <button className="link" onClick={() => setShowAll(!showAll)}>{showAll ? "收起" : "展开"}</button>}
      </Block>
      {lines.length > 0 && (
        <Block title="这次要改">{lines.map((line) => <span key={line} className="callout">{line}</span>)}</Block>
      )}
      <Block title="录音">
        {item.fileName ? (
          <>
            <div className="dot-card-player">
              <button className="dot-card-play" disabled={Boolean(s.saved)} title={playingMain ? "停止" : "试听"}
                onClick={() => (playingMain ? clip.stop() : clip.play(item.fileName))}>
                {playingMain ? (
                  <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden><rect x="1.5" y="1.5" width="8" height="8" rx="1.5" fill="currentColor" /></svg>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden><path d="M2.5 1.6v7.8a.6.6 0 0 0 .9.5l6.3-3.9a.6.6 0 0 0 0-1L3.4 1.1a.6.6 0 0 0-.9.5z" fill="currentColor" /></svg>
                )}
              </button>
              <div className="grow">
                <span className="dot-card-file">
                  <span className="ellipsis">{item.fileName}</span>
                  {duration !== null && <span className="secondary num">{clock(duration)}</span>}
                </span>
                {item.trim ? (
                  <Waveform trim={item.trim} progress={playingMain ? clip.progress : 0} />
                ) : (
                  <span className="dot-card-progress"><span style={{ transform: `scaleX(${playingMain ? clip.progress : 0})` }} /></span>
                )}
              </div>
            </div>
            {transcript && <span className="callout secondary selectable">识别出：“{transcript}”</span>}
            <span className="callout secondary">{[before, pairing].filter(Boolean).join(" · ")}</span>
          </>
        ) : (
          <span className="callout" style={{ color: modify ? "var(--text-2)" : "var(--orange)" }}>
            {modify ? "没有新录音，保持线上原来的录音。"
              : isKnowledge(summary, item) ? "没有找到录音，知识库问题不会上传。" : "没有找到录音，文字照常上传。"}
          </span>
        )}
      </Block>
      {item.needsReview && item.candidates.length > 0 && (
        <Block title="没把握，最像的是">
          {item.reason && <span className="callout" style={{ color: "var(--orange)" }}>{item.reason}</span>}
          {item.candidates.slice(0, 2).map((candidate) => (
            <span key={candidate.fileName} className="dot-card-candidate callout">
              <PlayButton file={candidate.fileName} playing={clip.playing} play={clip.play} stop={clip.stop} />
              <span className="ellipsis grow">{candidate.fileName}</span>
              <span className="secondary num">{Math.round(candidate.score * 100)}%</span>
            </span>
          ))}
        </Block>
      )}
      <div className="dot-card-foot">
        {!item.fileName && !modify && <Button size="small" onClick={() => void window.tungee.openPath(audioDir)}>打开文件夹</Button>}
        <span className="grow" />
        <Button size="small" disabled={busy(s) || Boolean(s.saved)} onClick={() => {
          close();
          set({ matchFocus: item.audioNumber, matchMode: "list" });
        }}>换一个录音…</Button>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="dot-card-block">
      <span className="dot-card-label">{title}</span>
      {children}
    </div>
  );
}
