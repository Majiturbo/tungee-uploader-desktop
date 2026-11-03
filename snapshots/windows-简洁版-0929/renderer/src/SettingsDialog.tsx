import { useEffect } from "react";
import { FolderIcon, HardDrive, InfoIcon, Sparkles, X } from "./icons";

interface SettingsDialogProps {
  taskRunning: boolean;
  onTour: () => void;
  onStorage: () => void;
  onClose: () => void;
}

export function SettingsDialog({ taskRunning, onTour, onStorage, onClose }: SettingsDialogProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="storage-dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
        <header className="dialog-head">
          <div><h3 id="settings-dialog-title">设置</h3></div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </header>
        <div className="storage-list">
          <div className="storage-item">
            <span className="row-icon"><Sparkles size={18} /></span>
            <span className="storage-text"><b>新手引导</b><small>用示例数据演示一遍完整流程</small></span>
            <button className="button" onClick={onTour} disabled={taskRunning} title={taskRunning ? "任务进行中，结束后再看" : undefined}>重新学习</button>
          </div>
          <div className="storage-item">
            <span className="row-icon"><HardDrive size={18} /></span>
            <span className="storage-text"><b>缓存</b><small>浏览器缓存、转换后的录音等</small></span>
            <button className="button" onClick={onStorage}>清理…</button>
          </div>
          <div className="storage-item">
            <span className="row-icon"><FolderIcon size={18} /></span>
            <span className="storage-text"><b>运行日志</b><small>出问题时发给维护人员</small></span>
            <button className="button" onClick={() => void window.tungee.openLogFolder()}>打开</button>
          </div>
          <div className="storage-item">
            <span className="row-icon"><InfoIcon size={18} /></span>
            <span className="storage-text"><b>版本</b></span>
            <em>{__APP_VERSION__}</em>
          </div>
        </div>
      </section>
    </div>
  );
}
