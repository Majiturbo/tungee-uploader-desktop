import { useState, type ReactNode } from "react";
import { FolderOpen } from "lucide-react";
import type { ModifyItem, ModifyPlan } from "../../shared/modify";
import { PlayButton, usePlayer } from "./AudioMatchSheet";
import {
  comparing,
  fileName,
  logTime,
  modifying,
  selectedItems,
  STAGE_TITLES,
  toggleModifyItem,
  update,
  useModel,
  type State,
} from "./model";
import { RecordingDot, type Mood } from "./Recordings";
import { Banners, Button, Page, PageHeader, Panel, PanelRow, RowLabel, Switch, TriangleFill } from "./ui";
import { LoginBanner } from "./UploadPage";

const DONE_NOTE = "上次已经改过";

type Group = "look" | "both" | "audio" | "text" | "new" | "online";

const GROUP_TITLES: Record<Group, string> = {
  look: "需要你看一眼",
  both: "文字和录音",
  audio: "只换录音",
  text: "只改文字或问法",
  new: "新增",
  online: "表里没有（不处理）",
};

const KIND_TITLES: Record<ModifyItem["kind"], string> = { flow: "主流程", vague: "含糊话术", knowledge: "知识库" };

const warnings = (item: ModifyItem) => item.warnings.filter((warning) => warning !== DONE_NOTE);

function groupOf(item: ModifyItem): Group | null {
  if (item.status === "same") return null;
  if (item.status === "online-only") return "online";
  if (item.status === "blocked" || warnings(item).length > 0) return "look";
  if (item.status === "new") return "new";
  const text = item.textChanged || item.phrasesChanged;
  if (text && item.audioFile) return "both";
  return item.audioFile ? "audio" : "text";
}

const clip = (value: string | null, limit = 36) => {
  const chars = [...(value ?? "")];
  return chars.length > limit ? `${chars.slice(0, limit).join("")}…` : chars.join("");
};

export function changeDetails(item: ModifyItem): string[] {
  const lines: string[] = [];
  if (item.status === "new") lines.push(`回答：${clip(item.newText, 60)}`);
  else if (item.status === "online-only") lines.push("探迹里有，表里没有，不会删除");
  else {
    if (item.textChanged) lines.push(`「${clip(item.onlineText)}」→「${clip(item.newText)}」`);
    if (item.addedPhrases.length) lines.push(`加问法：${item.addedPhrases.join("、")}`);
    if (item.removedPhrases.length) lines.push(`删问法：${item.removedPhrases.join("、")}`);
  }
  if (item.audioFile) lines.push(`换成录音「${item.audioFile}」`);
  if (item.warnings.includes(DONE_NOTE)) lines.push(DONE_NOTE);
  return lines;
}

export function changeSummary(item: ModifyItem): string {
  if (item.status === "new") return "新增问题";
  const parts = [
    item.textChanged && (item.kind === "knowledge" ? "改回答" : "改文字"),
    item.phrasesChanged && "改问法",
    item.audioFile && "换录音",
  ].filter(Boolean);
  return parts.join("、");
}

const selectable = (item: ModifyItem) => item.status === "changed" || item.status === "new";

function ChangeRow({ item, checked, disabled, trailing }: { item: ModifyItem; checked: boolean; disabled: boolean; trailing?: ReactNode }) {
  const canTick = selectable(item);
  return (
    <div className={`change-row${canTick ? "" : " is-inert"}`}>
      <span className="glyph">
        {canTick ? (
          <label className="check">
            <input type="checkbox" checked={checked} disabled={disabled} aria-label={item.label}
              onChange={(event) => toggleModifyItem(item.id, event.target.checked)} />
          </label>
        ) : item.status === "blocked" ? <TriangleFill size={15} /> : null}
      </span>
      <div className="text">
        <b>{item.label}<span className="kind">{KIND_TITLES[item.kind]}</span></b>
        {changeDetails(item).map((line) => <span key={line}>{line}</span>)}
        {warnings(item).map((line) => <span key={line} className="warn">{line}</span>)}
      </div>
      {trailing}
    </div>
  );
}

function ChangeList({ s, plan }: { s: State; plan: ModifyPlan }) {
  const player = usePlayer(s.config.audioDir);
  const [showOnline, setShowOnline] = useState(false);
  const groups = new Map<Group, ModifyItem[]>();
  for (const item of plan.items) {
    const group = groupOf(item);
    if (group) groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  const order: Group[] = ["look", "both", "audio", "text", "new", "online"];
  const disabled = comparing(s) || modifying(s);
  const unused = plan.unusedFiles.length > 0;
  return (
    <>
      {order.map((group) => {
        const items = groups.get(group) ?? [];
        const extra = group === "look" && unused ? 1 : 0;
        if (!items.length && !extra) return null;
        const collapsed = group === "online" && !showOnline;
        return (
          <section key={group} className="section" style={{ gap: 6 }} data-tour={`changes-${group}`}>
            <div className="section-title">
              {GROUP_TITLES[group]}
              <span className="secondary" style={{ fontWeight: 400 }}>{items.length + extra}</span>
              {group === "online" && (
                <button className="link" style={{ marginLeft: "auto", fontWeight: 400, fontSize: 13 }} onClick={() => setShowOnline(!showOnline)}>
                  {showOnline ? "收起" : "展开"}
                </button>
              )}
            </div>
            {!collapsed && (
              <div className="change-list">
                {extra > 0 && (
                  <div className="change-row is-inert">
                    <span className="glyph"><TriangleFill size={15} /></span>
                    <div className="text">
                      <b>{plan.unusedFiles.length} 个录音没配上</b>
                      <span>{plan.unusedFiles.join("、")}：不会上传。</span>
                    </div>
                  </div>
                )}
                {items.map((item) => (
                  <ChangeRow key={item.id} item={item} checked={s.modifySelected.has(item.id)} disabled={disabled}
                    trailing={item.audioFile ? <PlayButton file={item.audioFile} {...player} /> : undefined} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

export function compareMood(s: State): Mood {
  if (s.error) return "error";
  if (s.stage === "login") return "attention";
  if (s.modifyPlan && (s.modifyPlan.unusedFiles.length > 0 || s.modifyPlan.items.some((item) => groupOf(item) === "look"))) return "attention";
  return "calm";
}

function compareTitle(s: State): string {
  if (s.stage === "login" && comparing(s)) return "请在 Chrome 里登录探迹";
  if (comparing(s)) return "正在和线上对比";
  const plan = s.modifyPlan;
  if (!plan) return s.error ? "对比没有完成" : "和线上对比";
  const items = selectedItems(s);
  if (!plan.items.some(selectable)) return "线上和表格一致";
  const audio = items.filter((item) => item.audioFile).length;
  return `改 ${items.length} 处${audio ? `，换 ${audio} 条录音` : ""}`;
}

function compareSubtitle(s: State): string {
  if (s.stage === "login" && comparing(s)) return "在 Chrome 中登录探迹后，返回本工具确认登录。";
  if (comparing(s)) return s.logs.at(-1)?.message ?? "马上开始。";
  const plan = s.modifyPlan;
  if (!plan) {
    if (s.error) return s.error.message;
    if (!s.summary?.canUpload) return "先在「体检」里检查数据。";
    return `打开探迹里的「${s.config.talkName}」，只读不改，找出和表格不一样的地方。`;
  }
  if (!plan.items.some(selectable)) return "没有要改的地方。";
  return "改之前的线上内容已备份。勾选要改的，再点右上角“下一步：修改”。";
}

function readTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function ComparePage() {
  const s = useModel();
  const plan = s.modifyPlan;
  const caption = comparing(s) && s.progress.current !== undefined && s.progress.total !== undefined
    ? `${STAGE_TITLES[s.stage]} · ${s.progress.current}/${s.progress.total}`
    : plan ? `修改 · ${plan.talkName} · ${readTime(plan.readAt)} 读取` : `修改 · ${s.config.talkName || "未填写话术名称"}`;
  return (
    <Page>
      <PageHeader title={compareTitle(s)} subtitle={compareSubtitle(s)} caption={caption} tour="header" />
      <Banners />
      {s.stage === "login" && comparing(s) && <LoginBanner />}
      {plan && !comparing(s) && <ChangeList s={s} plan={plan} />}
    </Page>
  );
}

// MARK: Modify

export function modifyMood(s: State): Mood {
  if (s.stage === "completed" && s.modifyMessage) return "done";
  if (s.stage === "error") return "error";
  if (s.stage === "login") return "attention";
  return "calm";
}

function modifyTitle(s: State, total: number): string {
  if (!s.modifyPlan) return "还没有对比";
  if (s.stage === "login" && modifying(s)) return "请在 Chrome 里登录探迹";
  if (modifying(s)) return s.stage === "review" ? "正在提交审核" : `正在修改 ${s.modifyDone.size}/${total}`;
  if (s.stage === "completed" && s.modifyMessage) return "改完了";
  if (s.stage === "error") return "修改没有完成";
  if (s.stage === "cancelled") return "已经停下";
  return total ? `准备修改 ${total} 处` : "没有勾选要改的";
}

function modifySubtitle(s: State, total: number): string {
  if (!s.modifyPlan) return "先在「对比」页和线上对比。";
  if (s.stage === "login" && modifying(s)) return "在 Chrome 中登录探迹后，返回本工具确认登录。";
  if (modifying(s)) return s.logs.at(-1)?.message ?? "马上开始。";
  if (s.stage === "completed" && s.modifyMessage) return `${s.modifyMessage}。`;
  if (s.stage === "error") return s.error?.message ?? "中途出了点问题。";
  if (s.stage === "cancelled") return "改好的留在探迹里，再点“开始修改”会跳过它们。";
  if (!total) return "回到「对比」页勾选要改的地方。";
  return `只改勾选的这些，其他内容不动。${s.config.submitReview ? "改完提交审核。" : "改完话术保持编辑中。"}`;
}

const parentDir = (target: string) => target.replace(/[\\/][^\\/]*$/, "");

export function ModifyPage() {
  const s = useModel();
  const [showAllLogs, setShowAllLogs] = useState(false);
  const items = selectedItems(s);
  const running = modifying(s);
  const state = (item: ModifyItem) => (s.modifyDone.has(item.id) ? "done" : s.modifyActive === item.id ? "active" : "pending");
  const caption = running && s.progress.current !== undefined && s.progress.total !== undefined
    ? `${STAGE_TITLES[s.stage]} · ${s.progress.current}/${s.progress.total}` : `修改 · ${s.config.talkName}`;
  const limit = 6;
  const logs = showAllLogs ? s.logs : s.logs.slice(-limit);
  const backup = s.modifyPlan?.backupPath;
  return (
    <Page>
      <PageHeader title={modifyTitle(s, items.length)} subtitle={modifySubtitle(s, items.length)} caption={caption} tour="header" />
      <Banners />
      {s.stage === "login" && running && <LoginBanner />}
      {items.length > 0 && (
        <section className="section" style={{ gap: 6 }} data-tour="modifyList">
          <div className="section-title">要改的地方<span className="secondary" style={{ fontWeight: 400 }}>{items.length}</span></div>
          <div className="change-list">
            {items.map((item) => (
              <div key={item.id} className="change-row is-compact">
                <span className="glyph"><RecordingDot state={state(item)} /></span>
                <div className="text">
                  <b>{item.label}<span className="kind">{KIND_TITLES[item.kind]}</span></b>
                </div>
                <span className="secondary">{changeSummary(item)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {s.modifyPlan && (
        <Panel title="修改设置" tour="modifySettings">
          <PanelRow trailing={<span className="secondary">{s.config.talkName}</span>}>话术名称</PanelRow>
          {backup && (
            <PanelRow trailing={<Button onClick={() => void window.tungee.openPath(parentDir(backup))}><FolderOpen size={14} strokeWidth={1.7} />打开</Button>}>
              <RowLabel title="改之前的备份" detail={fileName(backup)} />
            </PanelRow>
          )}
          <PanelRow trailing={<Switch label="完成后提交审核" on={s.config.submitReview} disabled={running}
            onChange={(submitReview) => update((config) => ({ ...config, submitReview }))} />}>
            <RowLabel title="完成后提交审核" detail="建议先在探迹里检查一遍，再手动提交。" />
          </PanelRow>
        </Panel>
      )}
      {s.logs.length > 0 && !s.showInspector && (
        <section className="section" style={{ gap: 6 }} data-tour="log">
          <div className="section-title">
            运行记录
            {s.logs.length > limit && (
              <button className="link" style={{ marginLeft: "auto", fontWeight: 400, fontSize: 13 }} onClick={() => setShowAllLogs(!showAllLogs)}>
                {showAllLogs ? "只看最近" : `全部 ${s.logs.length} 条`}
              </button>
            )}
          </div>
          <div>
            {logs.map((event, index) => (
              <div key={index} className="page-log-row">
                <time>{logTime(event.timestamp)}</time>
                <span style={{ color: event.stage === "error" ? "var(--red)" : index === logs.length - 1 ? "var(--text)" : "var(--text-2)" }}>{event.message}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </Page>
  );
}
