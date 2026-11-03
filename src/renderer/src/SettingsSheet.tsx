import { useEffect, useState } from "react";
import { editionBlurb, isLite, PRODUCT_NAME, versionLabel, WINDOW_TITLE } from "../../shared/edition";
import type { StorageCategory, StorageUsage } from "../../shared/types";
import { busy, get, set, STEP_TITLES, useModel } from "./model";
import { start as startTour } from "./tour-store";
import { Button, Sheet, Spinner, Switch } from "./ui";

const EMAIL = "3301378498@qq.com";

function bytes(value: number): string {
  if (value < 1000) return `${value} 字节`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1000;
  let unit = 0;
  while (size >= 1000 && unit < units.length - 1) {
    size /= 1000;
    unit += 1;
  }
  return `${size >= 100 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

function platformName(): string {
  const agent = navigator.userAgent;
  const version = /Windows NT ([\d.]+)/.exec(agent)?.[1];
  return version ? `Windows NT ${version}` : navigator.platform;
}

export function SettingsSheet() {
  const s = useModel();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [selected, setSelected] = useState<Set<StorageCategory>>(new Set());
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    window.tungee.getStorageUsage().then((result) => {
      if (result.status === "ok") setUsage(result.usage);
      else setMessage(result.error.message);
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)));
  }, []);

  const close = () => set({ settingsOpen: false });

  const clear = async () => {
    setClearing(true);
    try {
      const result = await window.tungee.clearStorage([...selected]);
      if (result.status === "ok") {
        setUsage(result.usage);
        setSelected(new Set());
        setMessage(`释放了 ${bytes(Math.max(result.freedBytes, 0))}`);
      } else {
        setMessage(result.error.message);
      }
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setClearing(false);
    }
  };

  const sendFeedback = () => {
    const current = get();
    const context = [`版本：${versionLabel(__APP_VERSION__)}`, `系统：${platformName()}`, `当前步骤：${STEP_TITLES[current.step]}`,
      current.error ? `错误代码：${current.error.code}` : null].filter(Boolean).join("\n");
    const body = `你好，我在使用${WINDOW_TITLE}时遇到了问题。\n\n【做到哪一步】\n【看到的提示】（可以附截图）\n【希望怎样】\n\n——\n${context}`;
    void window.tungee.sendFeedback(EMAIL, `${PRODUCT_NAME}${isLite() ? "轻量版" : ""} 问题反馈`, body);
  };

  const copyEmail = async () => {
    await window.tungee.copyText(EMAIL);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Sheet width={560} height={680} onClose={close}>
      <div className="sheet-head" style={{ padding: "28px 36px 0" }}><h2>设置</h2></div>
      <div className="sheet-body">
        <div className="form">
          <section className="form-section">
            <header>存储空间{usage && <span>{bytes(usage.totalBytes)}</span>}</header>
            <div className="form-group">
              {usage ? (
                <>
                  {usage.items.map((item) => (
                    <div key={item.id} className="form-row">
                      <span className="label">
                        <span>{item.label}  <span className="secondary">{bytes(item.bytes)}</span></span>
                        <small>{item.description}</small>
                      </span>
                      <Switch label={item.label} on={selected.has(item.id)} onChange={(on) => setSelected((current) => {
                        const next = new Set(current);
                        if (on) next.add(item.id);
                        else next.delete(item.id);
                        return next;
                      })} />
                    </div>
                  ))}
                  <div className="form-row">
                    <span className="secondary" style={{ flex: 1 }}>{message}</span>
                    <Button disabled={selected.size === 0 || clearing || busy(s)} onClick={() => void clear()}>清理所选</Button>
                  </div>
                </>
              ) : (
                <div className="form-row">{message ? <span className="secondary">{message}</span> : <Spinner />}</div>
              )}
            </div>
          </section>

          <section className="form-section">
            <header>关于</header>
            <div className="form-group">
              <div className="form-row">
                <span className="label"><span>新手引导</span><small>用示例话术把四个步骤走一遍</small></span>
                <Button disabled={busy(s)} onClick={() => {
                  close();
                  setTimeout(() => startTour(), 400);
                }}>重新看一遍</Button>
              </div>
              <div className="form-row">
                <span className="label"><span>运行日志</span><small>记录每一步操作，排查问题时用</small></span>
                <Button onClick={() => void window.tungee.openLogFolder()}>打开</Button>
              </div>
              <div className="form-row">
                <span className="label">
                  <span>版本</span>
                  {isLite() && <small>{editionBlurb()}</small>}
                </span>
                <span className="value" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {versionLabel(__APP_VERSION__)}
                  {isLite() && <span className="lite-badge">Lite</span>}
                </span>
              </div>
            </div>
          </section>

          <section className="form-section">
            <header>反馈与建议</header>
            <div className="form-group">
              <div className="form-row">
                <span className="label">
                  <span>遇到问题或有建议</span>
                  <small>直接发邮件就好，会一起打开运行日志文件夹。邮件里请写清楚做到哪一步、看到了什么提示、你希望它怎样。</small>
                </span>
                <Button onClick={sendFeedback}>写邮件…</Button>
              </div>
              <div className="form-row">
                <span className="label">邮箱</span>
                <button className="link" title="点一下拷贝邮箱地址" onClick={() => void copyEmail()}>{copied ? "已拷贝" : EMAIL}</button>
              </div>
              <div className="form-row">
                <span className="label">设计</span>
                <span className="value">Design by 马德槐</span>
              </div>
            </div>
          </section>
        </div>
      </div>
      <div className="sheet-foot" style={{ justifyContent: "flex-end", padding: 20 }}>
        <Button prominent onClick={close}>完成</Button>
      </div>
    </Sheet>
  );
}
