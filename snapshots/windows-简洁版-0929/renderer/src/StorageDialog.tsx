import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, HardDrive, LoaderCircle, RefreshCw, Trash2, X } from "./icons";
import type { AppErrorInfo, StorageCategory, StorageUsage } from "../../shared/types";

const defaultSelection: StorageCategory[] = ["browser-cache", "converted-audio", "app-cache"];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function toError(error: unknown): AppErrorInfo {
  return {
    code: "E-APP-001",
    message: "桌面应用通信失败。",
    suggestion: "请关闭本工具后重新打开；若仍出现，请把技术详情发给维护人员。",
    detail: error instanceof Error ? error.message : String(error),
  };
}

interface StorageDialogProps {
  taskRunning: boolean;
  onClose: () => void;
}

export function StorageDialog({ taskRunning, onClose }: StorageDialogProps) {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [selected, setSelected] = useState<Set<StorageCategory>>(new Set(defaultSelection));
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<AppErrorInfo | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.tungee.getStorageUsage();
      if (result.status === "ok") setUsage(result.usage);
      else setError(result.error);
    } catch (reason: unknown) {
      setError(toError(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !clearing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearing, onClose]);

  const selectedBytes = useMemo(() => {
    if (!usage) return 0;
    const includesProfile = selected.has("login-data");
    return usage.items
      .filter((item) => selected.has(item.id) || (includesProfile && item.id === "browser-cache"))
      .reduce((total, item) => total + item.bytes, 0);
  }, [usage, selected]);

  const browserBlocked = taskRunning && (selected.has("browser-cache") || selected.has("login-data"));

  const toggle = (id: StorageCategory) => {
    setNotice(null);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clear = async () => {
    if (!selected.size) return;
    if (selected.has("login-data") && !window.confirm("清理探迹登录信息后，下次上传需要重新登录探迹。确定继续吗？")) return;
    setClearing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.tungee.clearStorage([...selected]);
      if (result.status === "ok") {
        setUsage(result.usage);
        setNotice(`已释放 ${formatBytes(result.freedBytes)}`);
      } else {
        setError(result.error);
      }
    } catch (reason: unknown) {
      setError(toError(reason));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !clearing) onClose(); }}>
      <section className="storage-dialog" role="dialog" aria-modal="true" aria-labelledby="storage-dialog-title">
        <header className="dialog-head">
          <div>
            <HardDrive size={18} />
            <h3 id="storage-dialog-title">清理缓存占用</h3>
          </div>
          <button className="icon-button" onClick={onClose} disabled={clearing} aria-label="关闭"><X size={16} /></button>
        </header>

        <div className="storage-total">
          <span>当前共占用</span>
          <strong>{usage ? formatBytes(usage.totalBytes) : "—"}</strong>
          <button className="text-action" onClick={() => void refresh()} disabled={loading || clearing}>
            <RefreshCw size={13} className={loading ? "spin" : undefined} />重新计算
          </button>
        </div>

        {loading && !usage ? (
          <div className="storage-loading"><LoaderCircle size={18} className="spin" />正在计算占用空间…</div>
        ) : (
          <div className="storage-list">
            {usage?.items.map((item) => (
              <label key={item.id} className={`storage-item ${selected.has(item.id) ? "is-selected" : ""} ${item.id === "login-data" ? "is-sensitive" : ""}`}>
                <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} disabled={clearing} />
                <span className="check-box"><Check size={13} /></span>
                <span className="storage-text">
                  <b>{item.label}</b>
                  <small>{item.description}</small>
                </span>
                <em>{formatBytes(item.bytes)}</em>
              </label>
            ))}
          </div>
        )}

        {browserBlocked && (
          <div className="storage-hint"><AlertTriangle size={14} />上传任务运行中，浏览器缓存和登录信息要等任务结束后才能清理。</div>
        )}
        {error && (
          <div className="storage-hint is-error">
            <AlertTriangle size={14} />
            <span><code>{error.code}</code>{error.message}{error.suggestion}</span>
          </div>
        )}
        {notice && <div className="storage-hint is-success"><CheckCircle2 size={14} />{notice}</div>}

        <footer className="dialog-foot">
          <span>已选 {selected.size} 项 · 约 {formatBytes(selectedBytes)}</span>
          <div>
            <button className="button outline" onClick={onClose} disabled={clearing}>关闭</button>
            <button className="button danger" onClick={() => void clear()} disabled={!selected.size || clearing || loading || browserBlocked}>
              {clearing ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}
              {clearing ? "正在清理" : "清理所选"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
