import { useState } from "react";
import { RotateCw, TextCursorInput, UserRoundCheck } from "lucide-react";
import type { AudioMatchItem, PreviewSummary, UploadCheckpointInfo } from "../../shared/types";
import {
  busy,
  canRun,
  canStart,
  confirmLogin,
  logTime,
  modifyExistingTalk,
  renameValid,
  set,
  STAGE_TITLES,
  startUpload,
  submitRename,
  update,
  useExistingTalk,
  isTrimmed,
  uploading,
  useModel,
  type State,
} from "./model";
import { RecordingMap, type DotState, type Mood } from "./Recordings";
import { Banners, Button, Page, PageHeader, Panel, PanelRow, RowLabel, Soft, Switch } from "./ui";

export function uploadMood(s: State): Mood {
  switch (s.stage) {
    case "completed": return "done";
    case "error": return "error";
    case "login":
    case "rename": return "attention";
    default: return "calm";
  }
}

function title(s: State, total: number): string {
  const summary = s.summary;
  if (!summary) return "还不能上传";
  switch (s.stage) {
    case "converting":
    case "launching": return "正在准备";
    case "login": return "请在 Chrome 里登录探迹";
    case "rename": return "换个话术名称";
    case "flow":
    case "vague":
    case "knowledge": return `正在上传 ${s.uploadDone.size}/${total}`;
    case "intent": return "正在设置意向";
    case "review": return "正在提交审核";
    case "completed": return "传完了";
    case "error": return s.checkpoint ? "传到一半停下了" : "上传没有完成";
    case "cancelled": return "已经停下";
    default:
      if (s.checkpoint) return "上次传到一半";
      if (!summary.canUpload) return "还不能上传";
      if (!canRun(s)) return "还差话术名称";
      return "准备好了";
  }
}

function subtitle(s: State, total: number): string {
  const summary = s.summary;
  if (!summary) return "先导入文件并完成体检。";
  const last = s.logs.at(-1)?.message;
  switch (s.stage) {
    case "converting":
    case "launching":
    case "flow":
    case "vague":
    case "knowledge":
    case "intent":
    case "review": return last ?? "马上开始。";
    case "login": return "在 Chrome 中登录探迹后，返回本工具确认登录。";
    case "rename": return `探迹里已经有「${s.config.talkName}」了。想改它就点“改这套话术”，上次没传完就接着传，否则换个名字。`;
    case "completed": return s.uploadMessage ?? last ?? "所有内容都已上传。";
    case "error": return s.error?.message ?? "中途出了点问题。";
    case "cancelled": return s.checkpoint ? "已传的内容留在探迹里，点“接着传”会跳过它们。" : "已传的内容留在探迹里，随时可以再传一次。";
    default: {
      if (!summary.canUpload) return `体检里还有 ${summary.errorCount} 处错误要先改。`;
      if (!canRun(s)) return "回到导入页填一下话术名称和知识库分类。";
      if (s.checkpoint) return `接着传只补剩下的 ${Math.max(0, total - s.checkpoint.doneAudioNumbers.length)} 条，传到「${s.checkpoint.talkName}」。`;
      const parts = [`${summary.plannedUploadCount} 条录音会传到探迹的「${s.config.talkName}」`];
      if (s.scheduledIntents && s.scheduledIntents.length > 0) parts.push(`传完再新建 ${s.scheduledIntents.length} 条意向`);
      return `${parts.join("，")}。`;
    }
  }
}

function savedAt(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  const format = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  const text = minutes < 60 ? format.format(-minutes, "minute") : minutes < 1440 ? format.format(-Math.round(minutes / 60), "hour") : format.format(-Math.round(minutes / 1440), "day");
  return `（${text}）`;
}

export function UploadPage() {
  const s = useModel();
  const [showAllLogs, setShowAllLogs] = useState(false);
  const total = s.summary?.audioMatch.items.length ?? 0;
  const isUploading = uploading(s);
  const live = isUploading || s.stage === "completed" || s.checkpoint !== null;
  const caption = isUploading && s.progress.current !== undefined && s.progress.total !== undefined
    ? `${STAGE_TITLES[s.stage]} · ${s.progress.current}/${s.progress.total}` : null;

  const legend: Array<[DotState, string]> = !isUploading && s.checkpoint ? [["done", "已上传"], ["pending", "还没传"]]
    : live ? [["done", "已上传"], ["active", "正在传"], ["pending", "等待"]]
    : [["matched", "已配对"], ["converted", "上传前处理"], ["missing", "缺录音"]];

  const dotState = (item: AudioMatchItem, summary: PreviewSummary): DotState => {
    if (live) {
      if (s.uploadActive === item.audioNumber) return "active";
      const done = isUploading ? s.uploadDone : new Set(s.checkpoint?.doneAudioNumbers ?? [...s.uploadDone]);
      if (done.has(item.audioNumber)) return item.fileName === null ? "missing" : "done";
      return "pending";
    }
    if (item.fileName === null) return "missing";
    return summary.convertAudioNumbers.includes(item.audioNumber) || isTrimmed(summary, item) ? "converted" : "matched";
  };

  const limit = 6;
  const logs = showAllLogs ? s.logs : s.logs.slice(-limit);

  return (
    <Page>
      <PageHeader title={title(s, total)} subtitle={subtitle(s, total)} caption={caption} />
      <Banners />
      {s.stage === "login" && <LoginBanner />}
      {s.stage === "rename" && (
        <Soft tour="rename">
          <div className="banner-row">
            <TextCursorInput size={22} strokeWidth={1.6} color="var(--orange)" />
            <div className="text" style={{ gap: 5 }}>
              <b>探迹里已有同名话术</b>
              <input className="text-input" style={{ maxWidth: 280 }} placeholder="新的话术名称" value={s.renameDraft}
                onChange={(event) => set({ renameDraft: event.target.value })}
                onKeyDown={(event) => event.key === "Enter" && void submitRename()} />
              <span className="caption">{[...s.renameDraft.trim()].length}/19</span>
            </div>
            <Button onClick={() => void modifyExistingTalk()}>改这套话术</Button>
            <Button onClick={useExistingTalk}>接着传到「{s.config.talkName}」</Button>
            <Button prominent disabled={!renameValid(s)} onClick={() => void submitRename()}>用新名字继续</Button>
          </div>
        </Soft>
      )}
      {s.checkpoint && !isUploading && <Resume s={s} checkpoint={s.checkpoint} />}
      {s.summary?.canUpload && <RecordingMap summary={s.summary} state={(item) => dotState(item, s.summary!)} legend={legend} />}
      <Panel title="上传设置" tour="uploadSettings">
        <PanelRow trailing={<span className="secondary">{s.config.talkName || "未填写"}</span>}>话术名称</PanelRow>
        <PanelRow trailing={<span className="secondary">{s.config.categoryName}</span>}>知识库分类</PanelRow>
        <PanelRow trailing={<Button disabled={isUploading} onClick={() => set({ step: "intent" })}>去设置</Button>}>
          <RowLabel title="意向" detail={s.scheduledIntents ? `传完后自动新建 ${s.scheduledIntents.length} 条` : "不自动设置"} />
        </PanelRow>
        <PanelRow trailing={<Switch label="完成后提交审核" on={s.config.submitReview} disabled={isUploading}
          onChange={(submitReview) => update((config) => ({ ...config, submitReview }))} />}>
          <RowLabel title="完成后提交审核" detail="建议先在探迹里检查一遍，再手动提交。" />
        </PanelRow>
      </Panel>
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

export function LoginBanner() {
  return (
    <Soft tour="login">
      <div className="banner-row">
        <UserRoundCheck size={22} strokeWidth={1.6} color="var(--blue)" />
        <div className="text">
          <b>在 Chrome 里登录探迹</b>
          <span>在 Chrome 中登录探迹后，回到这里点确认。</span>
        </div>
        <Button prominent onClick={confirmLogin}>已登录，继续</Button>
      </div>
    </Soft>
  );
}

function Resume({ s, checkpoint }: { s: State; checkpoint: UploadCheckpointInfo }) {
  const disabled = !canStart(s) || busy(s);
  return (
    <Soft tour="resume">
      <div className="banner-row">
        <RotateCw size={22} strokeWidth={1.6} color="var(--blue)" />
        <div className="text">
          <b>上次传到一半</b>
          <span>「{checkpoint.talkName}」已完成 {checkpoint.doneAudioNumbers.length} 条{savedAt(checkpoint.updatedAt)}，接着传会跳过它们。</span>
        </div>
        <Button disabled={disabled} onClick={() => void startUpload()}>重新开始</Button>
        <Button prominent disabled={disabled} onClick={() => void startUpload(true)}>接着传</Button>
      </div>
    </Soft>
  );
}
