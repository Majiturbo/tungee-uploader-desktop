import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Crosshair } from "lucide-react";
import { nextStep } from "./coach";
import { useModel, set } from "./model";
import { guide } from "./tour-store";

// MARK: Filled glyphs, in the style of SF Symbols ".fill" variants.

type GlyphProps = { size?: number; color?: string; className?: string; style?: CSSProperties };

export function CheckCircleFill({ size = 16, color = "var(--blue)", className, style }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} style={style} aria-hidden>
      <circle cx="10" cy="10" r="9" fill={color} />
      <path d="M6 10.3l2.7 2.7L14.2 7.4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function XOctagonFill({ size = 16, color = "var(--red)", className, style }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} style={style} aria-hidden>
      <path d="M6.6 1.5h6.8l5.1 5.1v6.8l-5.1 5.1H6.6l-5.1-5.1V6.6z" fill={color} strokeLinejoin="round" stroke={color} strokeWidth="1" />
      <path d="M7.2 7.2l5.6 5.6M12.8 7.2l-5.6 5.6" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

export function TriangleFill({ size = 16, color = "var(--orange)", className, style }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} style={style} aria-hidden>
      <path d="M10 2.2c.5 0 .9.3 1.2.7l7.3 12.8c.5.9-.1 2-1.2 2H2.7c-1.1 0-1.7-1.1-1.2-2L8.8 2.9c.3-.4.7-.7 1.2-.7z" fill={color} />
      <path d="M10 7v4.6" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="10" cy="14.4" r="1.15" fill="#fff" />
    </svg>
  );
}

export function QuestionCircleFill({ size = 16, color = "var(--orange)", className, style }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} style={style} aria-hidden>
      <circle cx="10" cy="10" r="9" fill={color} />
      <path d="M7.6 7.7a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1.1.8-1.1 1.5v.4" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="14.6" r="1.1" fill="#fff" />
    </svg>
  );
}

export function InfoCircleFill({ size = 16, color = "var(--text-2)", className, style }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} style={style} aria-hidden>
      <circle cx="10" cy="10" r="9" fill={color} />
      <circle cx="10" cy="6.2" r="1.15" fill="#fff" />
      <path d="M10 9v5.4" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg className="spinner" width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      {Array.from({ length: 8 }, (_, index) => (
        <rect key={index} x="7.1" y="1" width="1.8" height="4" rx="0.9" fill="currentColor"
          opacity={0.25 + (index / 8) * 0.75} transform={`rotate(${index * 45} 8 8)`} />
      ))}
    </svg>
  );
}

export function Progress({ value, total }: { value?: number; total?: number }) {
  const determinate = value !== undefined && total !== undefined && total > 0;
  return (
    <div className={`progress${determinate ? "" : " is-indeterminate"}`}>
      <i style={determinate ? { width: `${Math.min(100, (value / total) * 100)}%` } : undefined} />
    </div>
  );
}

// MARK: Buttons

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  prominent?: boolean;
  size?: "small" | "large";
  disabled?: boolean;
  title?: string;
  tour?: string;
  className?: string;
};

export function Button({ children, onClick, prominent, size, disabled, title, tour, className }: ButtonProps) {
  const classes = ["btn", prominent && "is-prominent", size && `is-${size}`, className].filter(Boolean).join(" ");
  return (
    <button className={classes} onClick={onClick} disabled={disabled} title={title} data-tour={tour}>
      {children}
    </button>
  );
}

export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (value: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button className={`switch${on ? " is-on" : ""}`} role="switch" aria-checked={on} aria-label={label}
      disabled={disabled} onClick={() => onChange(!on)} />
  );
}

export function Check({ checked, onChange, children, disabled }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="grow">{children}</span>
    </label>
  );
}

export function SegmentedTabs<T extends string>({ items, value, onChange }: { items: Array<{ value: T; title: string }>; value: T; onChange: (value: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button key={item.value} role="tab" aria-selected={item.value === value} className={item.value === value ? "is-selected" : ""}
          onClick={() => onChange(item.value)}>
          {item.title}
        </button>
      ))}
    </div>
  );
}

// MARK: Page

export function Page({ children }: { children: ReactNode }) {
  return <div className="page">{children}</div>;
}

export function PageHeader({ title, subtitle, caption, tour }: { title: string; subtitle?: string; caption?: string | null; tour?: string }) {
  return (
    <header className="header" data-tour={tour}>
      <h1 className="text-swap" key={title}>{title}</h1>
      {subtitle && <div className="subtitle text-swap" key={subtitle}>{subtitle}</div>}
      {caption && <div className="caption-line text-swap" key={caption}>{caption}</div>}
      <NextStepLine />
    </header>
  );
}

export function NextStepLine() {
  const s = useModel();
  const next = nextStep(s);
  const [idle, setIdle] = useState(false);
  const id = next?.id;
  useEffect(() => {
    setIdle(false);
    const timer = setTimeout(() => setIdle(true), 20000);
    return () => clearTimeout(timer);
  }, [id]);
  if (!next) return null;
  return (
    <div className="next-line">
      {next.waiting && <Spinner />}
      <b>下一步</b>
      <span>{next.hint}</span>
      {next.optional && <span className="caption secondary">可以跳过</span>}
      {!next.waiting && (
        <Button size="small" className={idle ? "is-idle" : undefined} tour="nextStepButton" onClick={() => guide(next)}>
          <Crosshair size={13} strokeWidth={2} />指给我看
        </Button>
      )}
    </div>
  );
}

export function Soft({ children, tour, className }: { children: ReactNode; tour?: string; className?: string }) {
  return <div className={`card soft${className ? ` ${className}` : ""}`} data-tour={tour}>{children}</div>;
}

export function Panel({ title, trailing, children, tour }: { title?: string; trailing?: string; children: ReactNode; tour?: string }) {
  return (
    <section className="section" data-tour={tour}>
      {title && <div className="section-title">{title}{trailing && <span className="secondary" style={{ fontWeight: 400 }}>{trailing}</span>}</div>}
      <div className="card panel">{children}</div>
    </section>
  );
}

export function PanelRow({ children, trailing, tour }: { children: ReactNode; trailing?: ReactNode; tour?: string }) {
  return (
    <div className="panel-row" data-tour={tour}>
      <div className="grow" style={{ display: "flex", alignItems: "center", gap: 12 }}>{children}</div>
      {trailing}
    </div>
  );
}

export function RowLabel({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="row-label">
      <span>{title}</span>
      {detail && <small>{detail}</small>}
    </div>
  );
}

// MARK: Callouts

export function Callout({ icon, title, detail, children, tour }: { icon: ReactNode; title: string; detail?: string; children?: ReactNode; tour?: string }) {
  return (
    <div className="callout-box" data-tour={tour}>
      {icon}
      <div className="text">
        <b>{title}</b>
        {detail && <span className="secondary">{detail}</span>}
        {children}
      </div>
    </div>
  );
}

export function Banners() {
  const { error, notice } = useModel();
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => set((s) => (s.notice === notice ? { notice: null } : {})), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  if (!error && !notice) return null;
  return (
    <div className="banners">
      {error && (
        <Callout icon={<XOctagonFill size={18} />} title={error.message} detail={error.suggestion} tour="error">
          {error.detail && (
            <details className="tech">
              <summary>技术详情 · {error.code}</summary>
              <pre>{error.detail}</pre>
            </details>
          )}
        </Callout>
      )}
      {notice && <Callout icon={<CheckCircleFill size={18} color="var(--green)" />} title={notice} />}
    </div>
  );
}

// MARK: Sheet, alert, popover

export function Sheet({ width, height, children, onClose }: { width: number; height?: number; children: ReactNode; onClose?: () => void }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="scrim">
      <div className="sheet" role="dialog" aria-modal style={{ width, height }}>{children}</div>
    </div>,
    document.body,
  );
}

export function Alert({ title, message, confirm, onConfirm, onCancel }: { title: string; message: string; confirm: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Sheet width={300} onClose={onCancel}>
      <div className="alert">
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="actions">
          <Button prominent onClick={onConfirm}>{confirm}</Button>
          <Button onClick={onCancel}>取消</Button>
        </div>
      </div>
    </Sheet>
  );
}

export type Edge = "top" | "bottom" | "left" | "right";

/** Where a popover goes relative to its target: under toolbar items, above or below wide targets,
 * otherwise beside the target on the side with more room. */
export function edgeFor(rect: DOMRect): Edge {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (rect.top < 60) return "bottom";
  if (rect.width > width * 0.3) return rect.top > height - rect.bottom ? "top" : "bottom";
  return width - rect.right > rect.left ? "right" : "left";
}

/** Floating card with an arrow pointing at `anchor`. */
export function Popover({ anchor, edge, children, onDismiss, className }: {
  anchor: DOMRect;
  edge?: Edge;
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; arrow: number; side: Edge } | null>(null);
  const side = edge ?? edgeFor(anchor);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const gap = 10;
    const margin = 8;
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    let left: number;
    let top: number;
    if (side === "bottom" || side === "top") {
      left = clamp(anchor.left + anchor.width / 2 - width / 2, margin, window.innerWidth - width - margin);
      top = side === "bottom" ? anchor.bottom + gap : anchor.top - gap - height;
      top = clamp(top, margin, window.innerHeight - height - margin);
      setPlace({ left, top, arrow: clamp(anchor.left + anchor.width / 2 - left, 18, width - 18), side });
    } else {
      top = clamp(anchor.top + anchor.height / 2 - height / 2, margin, window.innerHeight - height - margin);
      left = side === "right" ? anchor.right + gap : anchor.left - gap - width;
      left = clamp(left, margin, window.innerWidth - width - margin);
      setPlace({ left, top, arrow: clamp(anchor.top + anchor.height / 2 - top, 18, height - 18), side });
    }
  }, [anchor.left, anchor.top, anchor.width, anchor.height, side, children]);
  const arrowSide = place ? ({ bottom: "top", top: "bottom", right: "left", left: "right" } as const)[place.side] : "top";
  const arrowStyle: CSSProperties = place
    ? place.side === "bottom" || place.side === "top" ? { left: place.arrow - 7 } : { top: place.arrow - 7 }
    : {};
  return createPortal(
    <>
      {onDismiss && <div className="popover-catcher" onMouseDown={onDismiss} />}
      <div ref={ref} className={`popover${className ? ` ${className}` : ""}`} role="dialog"
        style={{ left: place?.left ?? -9999, top: place?.top ?? -9999 }}>
        <span className={`popover-arrow is-${arrowSide}`} style={arrowStyle} />
        {children}
      </div>
    </>,
    document.body,
  );
}
