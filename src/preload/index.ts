import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import type { AiProgress, DesktopApi, ProgressEvent, UploadConfig } from "../shared/types";

function isAiProgress(value: unknown): value is AiProgress {
  if (typeof value !== "object" || value === null) return false;
  const progress = value as Record<string, unknown>;
  return typeof progress.current === "number" && typeof progress.total === "number";
}

function isProgressEvent(value: unknown): value is ProgressEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return typeof event.stage === "string"
    && typeof event.message === "string"
    && typeof event.timestamp === "string";
}

const api: DesktopApi = {
  selectWorkbook: () => ipcRenderer.invoke("dialog:workbook") as Promise<string | null>,
  selectAudioDir: () => ipcRenderer.invoke("dialog:audio-dir") as Promise<string | null>,
  saveStandardTemplate: () => ipcRenderer.invoke("template:save"),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  inspectLocalPath: (targetPath: string) => ipcRenderer.invoke("path:inspect", targetPath),
  openLogFolder: () => ipcRenderer.invoke("logs:open") as Promise<string>,
  preview: (config: UploadConfig) => ipcRenderer.invoke("automation:preview", config),
  saveValidationReport: (config: UploadConfig) => ipcRenderer.invoke("report:validation", config),
  saveCheckupFix: (config, decisions, additions = {}) => ipcRenderer.invoke("checkup:save-fixed", config, decisions, additions),
  aiCheckup: (config) => ipcRenderer.invoke("checkup:ai", config),
  aiInvalidQa: (config) => ipcRenderer.invoke("checkup:invalid-ai", config),
  expandPhrases: (config, rowNumber, fresh = false) => ipcRenderer.invoke("checkup:expand", config, rowNumber, fresh),
  confirmAudioMatches: (config, decisions) => ipcRenderer.invoke("audio:confirm-matches", config, decisions),
  audioUrl: (audioDir, fileName) => `tungee-audio://local/?dir=${encodeURIComponent(audioDir)}&file=${encodeURIComponent(fileName)}`,
  start: (config: UploadConfig, intents = [], options = {}) => ipcRenderer.invoke("automation:start", config, intents, options),
  confirmLogin: () => ipcRenderer.invoke("automation:confirm-login") as Promise<boolean>,
  rename: (name: string) => ipcRenderer.invoke("automation:rename", name) as Promise<boolean>,
  useExisting: () => ipcRenderer.invoke("automation:use-existing") as Promise<boolean>,
  modifyExisting: () => ipcRenderer.invoke("automation:modify-existing") as Promise<boolean>,
  checkpoint: (config: UploadConfig) => ipcRenderer.invoke("automation:checkpoint", config),
  discardCheckpoint: (config: UploadConfig) => ipcRenderer.invoke("automation:discard-checkpoint", config) as Promise<boolean>,
  cancel: () => ipcRenderer.invoke("automation:cancel") as Promise<boolean>,
  compareTalk: (config) => ipcRenderer.invoke("modify:compare", config),
  modifyTalk: (config, ids) => ipcRenderer.invoke("modify:apply", config, ids),
  getStorageUsage: () => ipcRenderer.invoke("storage:usage"),
  clearStorage: (categories) => ipcRenderer.invoke("storage:clear", categories),
  onProgress: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => {
      if (isProgressEvent(payload)) callback(payload);
    };
    ipcRenderer.on("automation:progress", listener);
    return () => ipcRenderer.removeListener("automation:progress", listener);
  },
  analyzeIntent: (config) => ipcRenderer.invoke("intent:analyze", config),
  cancelAi: () => ipcRenderer.invoke("ai:cancel"),
  onAiProgress: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => {
      if (isAiProgress(payload)) callback(payload);
    };
    ipcRenderer.on("ai:progress", listener);
    return () => ipcRenderer.removeListener("ai:progress", listener);
  },
  copyText: (text) => ipcRenderer.invoke("clipboard:write", text),
  exportIntent: (config, markdown) => ipcRenderer.invoke("intent:export", config, markdown),
  fileIcon: (targetPath, kind) => ipcRenderer.invoke("path:icon", targetPath, kind),
  countAudio: (audioDir) => ipcRenderer.invoke("path:audio-count", audioDir),
  openPath: (targetPath) => ipcRenderer.invoke("path:open", targetPath),
  sendFeedback: (email, subject, body) => ipcRenderer.invoke("feedback:mail", email, subject, body),
};

contextBridge.exposeInMainWorld("tungee", api);
