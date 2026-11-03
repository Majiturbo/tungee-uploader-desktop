import { useEffect, useRef, useState } from "react";
import {
  AudioWaveform, CirclePlus, CircleStop, CloudUpload, Copy, Crosshair, Folder, Globe, Hand, HardDrive, Hash, Import, Lock, Redo2,
  RotateCcw, ShieldCheck, Sparkles, Stethoscope, TextCursor, type LucideIcon,
} from "lucide-react";
import { actionLabel } from "./coach";
import { STEP_TITLES, useModel } from "./model";
import { RecordingDot } from "./Recordings";
import {
  back, coachDismissed, finish, focusTarget, next, performCoach, setFollow, skipCoach, steps, stopCoach, useTour,
  type PointIcon, type TourPoint, type TourStep,
} from "./tour-store";
import { Button, CheckCircleFill, Popover, Progress } from "./ui";

const POINT_ICONS: Record<Exclude<PointIcon, "check" | "mood">, LucideIcon> = {
  import: Import, checkup: Stethoscope, intent: Crosshair, upload: CloudUpload, number: Hash, waveform: AudioWaveform, cursor: TextCursor,
  folder: Folder, copy: Copy, sparkles: Sparkles, plus: CirclePlus, skip: Redo2, hand: Hand, globe: Globe, lock: Lock, stop: CircleStop,
  restart: RotateCcw, drive: HardDrive, shield: ShieldCheck,
};

const MOOD_TINTS = ["var(--blue)", "var(--orange)", "var(--red)"];

/** Union of every element tagged `id`, clipped to the window. */
function rectFor(id: string): DOMRect | null {
  const rects = [...document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(id)}"]`)]
    .map((element) => element.getBoundingClientRect())
    .map((rect) => {
      const left = Math.max(rect.left, 0);
      const top = Math.max(rect.top, 0);
      const right = Math.min(rect.right, window.innerWidth);
      const bottom = Math.min(rect.bottom, window.innerHeight);
      return { left, top, right, bottom };
    })
    .filter((rect) => rect.right - rect.left > 1 && rect.bottom - rect.top > 1);
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

/** Waits for the target to appear and the page to finish scrolling to it, then keeps following it. */
function useAnchor(id: string | null, key: string | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    setRect(null);
    if (!id || !key) return;
    let cancelled = false;
    let follow: ReturnType<typeof setInterval> | undefined;
    const scroll = setTimeout(() => {
      document.querySelector(`[data-tour="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 150);
    void (async () => {
      for (let attempt = 0; attempt < 25 && !rectFor(id); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (cancelled) return;
      }
      await new Promise((resolve) => setTimeout(resolve, 450));
      if (cancelled) return;
      const measure = () => setRect((previous) => {
        const next = rectFor(id);
        if (!next) return previous;
        if (previous && Math.abs(previous.x - next.x) < 1 && Math.abs(previous.y - next.y) < 1
          && Math.abs(previous.width - next.width) < 1 && Math.abs(previous.height - next.height) < 1) return previous;
        return next;
      });
      measure();
      follow = setInterval(measure, 200);
    })();
    return () => {
      cancelled = true;
      clearTimeout(scroll);
      clearInterval(follow);
    };
  }, [id, key]);
  return rect;
}

function PointGlyph({ point, index, step }: { point: TourPoint; index: number; step: TourStep }) {
  if (point.dot) return <RecordingDot state={point.dot} />;
  if (point.badge) {
    const tint = point.badge === "A级" ? "var(--blue)" : point.badge === "B级" ? "var(--indigo)" : "var(--text-2)";
    return <span className="caption strong" style={{ color: tint }}>{point.badge}</span>;
  }
  if (point.icon === "mood") {
    return <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden><circle cx="4.5" cy="4.5" r="4.5" fill={MOOD_TINTS[Math.min(index, 2)]} /></svg>;
  }
  if (point.icon === "check") return <CheckCircleFill size={13} />;
  if (!point.icon) return null;
  const Icon = POINT_ICONS[point.icon];
  return <Icon size={13} strokeWidth={1.9} color={step.target === "header" ? MOOD_TINTS[Math.min(index, 2)] : "var(--blue)"} />;
}

export function Tour() {
  const tour = useTour();
  const s = useModel();
  const popover = useRef<HTMLDivElement>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const sheetOpen = s.matchMode !== null || s.checkupOpen || s.settingsOpen || s.templateGuideOpen || s.intentConfirming;
  const step = tour.index === null ? null : steps[tour.index]!;
  const coach = step ? null : tour.coach;
  const target = focusTarget() ?? (coach ? "nextStepButton" : "steps");
  const key = step ? `step-${tour.index}` : coach && !sheetOpen && dismissed !== coach.id ? `coach-${coach.id}` : null;
  const anchor = useAnchor(key ? target : null, key);

  useEffect(() => {
    if (!sheetOpen) setDismissed(null);
  }, [sheetOpen]);

  useEffect(() => {
    if (!step && !coach) return;
    const onKey = (event: KeyboardEvent) => {
      if (coach) {
        if (event.key === "Escape" && !sheetOpen) stopCoach();
        return;
      }
      const handled = ({ Escape: finish, Enter: next, ArrowRight: next, ArrowLeft: back } as Record<string, () => void>)[event.key];
      if (!handled) return;
      event.preventDefault();
      handled();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [step, coach, sheetOpen]);

  useEffect(() => {
    if (!coach) return;
    const onDown = (event: MouseEvent) => {
      if (popover.current?.contains(event.target as Node)) return;
      setDismissed(coach.id);
      coachDismissed();
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [coach]);

  if (!step && !coach) return null;
  const last = tour.index === steps.length - 1;

  return (
    <>
      {step && <div className="tour-blocker" onWheel={(event) => event.preventDefault()} />}
      {anchor && key && (
        <Popover anchor={anchor}>
          <div ref={popover} className="tour-card">
            {step ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div className="chapter"><b>{STEP_TITLES[step.page]}</b>
                    <span>{tour.index! + 1} / {steps.length}</span></div>
                  <Progress value={tour.index! + 1} total={steps.length} />
                </div>
                <h4>{step.title}</h4>
                {step.body && <p>{step.body}</p>}
                {step.points && step.points.length > 0 && (
                  <div className="tour-points">
                    {step.points.map((point, index) => (
                      <div key={point.text}><span className="point-icon"><PointGlyph point={point} index={index} step={step} /></span><span>{point.text}</span></div>
                    ))}
                  </div>
                )}
                <div className="tour-actions">
                  {!last && <button className="link" onClick={finish}>跳过</button>}
                  <span className="spacer" />
                  {tour.index! > 0 && <Button onClick={back}>上一步</Button>}
                  <Button prominent onClick={next}>{last ? "开始使用" : "下一步"}</Button>
                </div>
              </>
            ) : coach && (
              <>
                <div style={{ display: "flex", gap: 8 }}>
                  <span className="caption strong accent">下一步</span>
                  {coach.optional && <span className="caption secondary">可以跳过</span>}
                </div>
                <h4>{coach.title}</h4>
                {coach.body && <p>{coach.body}</p>}
                <label className="check callout" title="做完一步自动指下一步">
                  <input type="checkbox" checked={tour.follow} onChange={(event) => setFollow(event.target.checked)} />
                  <span>一路带到上传</span>
                </label>
                <div className="tour-actions" style={{ paddingTop: 4 }}>
                  <span className="spacer" />
                  {coach.optional && <Button onClick={skipCoach}>跳过</Button>}
                  {coach.help ? (
                    <Button prominent onClick={performCoach}>{actionLabel(coach.help)}</Button>
                  ) : (
                    <Button prominent={coach.waiting || !coach.target} onClick={stopCoach}>知道了</Button>
                  )}
                </div>
              </>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}
