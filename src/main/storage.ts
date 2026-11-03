import fs from "node:fs/promises";
import path from "node:path";
import { isLite } from "../shared/edition";
import { CONVERTED_AUDIO_DIR } from "./audio-format";
import { AUDIO_MATCH_STORE } from "./audio-match-store";
import { INTENT_CACHE_STORE } from "./intent-analyzer";
import type { StorageCategory, StorageItem, StorageUsage } from "../shared/types";

const CONVERTED_REGISTRY = "converted-audio-dirs.json";
const REMOVE_OPTIONS = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 } as const;

const BROWSER_CACHE_PATHS = [
  "Default/Cache",
  "Default/Code Cache",
  "Default/GPUCache",
  "Default/DawnGraphiteCache",
  "Default/DawnWebGPUCache",
  "Default/Service Worker/CacheStorage",
  "Default/Service Worker/ScriptCache",
  "GrShaderCache",
  "GraphiteDawnCache",
  "ShaderCache",
  "component_crx_cache",
  "extensions_crx_cache",
];

const APP_CACHE_PATHS = ["Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "Shared Dictionary", AUDIO_MATCH_STORE, INTENT_CACHE_STORE];

export const STORAGE_CATEGORIES: StorageCategory[] = ["browser-cache", "converted-audio", "logs", "app-cache", "login-data"];

export interface StoragePaths {
  userDataPath: string;
  logDir: string;
}

export interface StorageHooks {
  releaseBrowser: () => Promise<boolean>;
  clearAppCache: () => Promise<void>;
}

export function chromeProfileDir(userDataPath: string): string {
  return path.join(userDataPath, "chrome-profile");
}

async function pathSize(target: string): Promise<number> {
  let stats;
  try {
    stats = await fs.lstat(target);
  } catch {
    return 0;
  }
  if (stats.isFile()) return stats.size;
  if (!stats.isDirectory()) return 0;
  let entries: string[];
  try {
    entries = await fs.readdir(target);
  } catch {
    return 0;
  }
  const sizes = await Promise.all(entries.map((entry) => pathSize(path.join(target, entry))));
  return sizes.reduce((total, size) => total + size, 0);
}

async function totalSize(root: string, relativePaths: string[]): Promise<number> {
  const sizes = await Promise.all(relativePaths.map((relative) => pathSize(path.join(root, relative))));
  return sizes.reduce((total, size) => total + size, 0);
}

function registryPath(userDataPath: string): string {
  return path.join(userDataPath, CONVERTED_REGISTRY);
}

async function readConvertedDirs(userDataPath: string): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(registryPath(userDataPath), "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string" && path.basename(value) === CONVERTED_AUDIO_DIR);
  } catch {
    return [];
  }
}

async function writeConvertedDirs(userDataPath: string, dirs: string[]): Promise<void> {
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.writeFile(registryPath(userDataPath), JSON.stringify(dirs, null, 2), "utf8");
}

export async function rememberConvertedAudioDir(userDataPath: string, dir: string): Promise<void> {
  const dirs = await readConvertedDirs(userDataPath);
  if (dirs.includes(dir)) return;
  await writeConvertedDirs(userDataPath, [...dirs, dir]);
}

export async function getStorageUsage(paths: StoragePaths): Promise<StorageUsage> {
  const profileDir = chromeProfileDir(paths.userDataPath);
  const convertedDirs = await readConvertedDirs(paths.userDataPath);
  const [browserCache, profileTotal, converted, logs, appCache] = await Promise.all([
    totalSize(profileDir, BROWSER_CACHE_PATHS),
    pathSize(profileDir),
    Promise.all(convertedDirs.map((dir) => pathSize(dir))),
    pathSize(paths.logDir),
    totalSize(paths.userDataPath, APP_CACHE_PATHS),
  ]);
  const existingConverted = converted.filter((size) => size > 0).length;
  const items: StorageItem[] = [
    {
      id: "browser-cache",
      label: "浏览器缓存",
      description: "自动上传时 Chrome 产生的网页缓存。清理后不影响探迹登录状态。",
      bytes: browserCache,
    },
    {
      id: "converted-audio",
      label: "已转换录音",
      description: existingConverted
        ? `${existingConverted} 个录音文件夹下的「${CONVERTED_AUDIO_DIR}」子文件夹。原始录音不受影响，下次上传会重新转换。`
        : `录音文件夹下的「${CONVERTED_AUDIO_DIR}」子文件夹。原始录音不受影响。`,
      bytes: converted.reduce((total, size) => total + size, 0),
    },
    {
      id: "logs",
      label: "运行日志",
      description: "启动和运行记录。遇到问题需要排查时，维护人员可能会用到。",
      bytes: logs,
    },
    {
      id: "app-cache",
      label: "软件缓存",
      description: isLite()
        ? "软件界面缓存，以及录音识别结果和已确认的录音匹配。清理后下次会重新识别。"
        : "软件界面缓存，以及录音识别结果、已确认的录音匹配和本地 AI 的问题归类。清理后下次会重新识别和归类。",
      bytes: appCache,
    },
    {
      id: "login-data",
      label: "探迹登录信息",
      description: "Chrome 保存的探迹登录状态和浏览记录，会连同浏览器缓存一起清除。清理后下次上传需要重新登录。",
      bytes: Math.max(0, profileTotal - browserCache),
    },
  ];
  return { items, totalBytes: items.reduce((total, item) => total + item.bytes, 0) };
}

async function clearDirectoryContents(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(entries.map((entry) => fs.rm(path.join(dir, entry), REMOVE_OPTIONS)));
}

export class StorageBusyError extends Error {}

export async function clearStorage(
  paths: StoragePaths,
  categories: StorageCategory[],
  hooks: StorageHooks,
): Promise<{ freedBytes: number; usage: StorageUsage }> {
  const selected = new Set(categories);
  const before = await getStorageUsage(paths);
  const profileDir = chromeProfileDir(paths.userDataPath);

  if (selected.has("browser-cache") || selected.has("login-data")) {
    if (!(await hooks.releaseBrowser())) throw new StorageBusyError("上传任务运行中");
  }
  if (selected.has("login-data")) {
    await fs.rm(profileDir, REMOVE_OPTIONS);
  } else if (selected.has("browser-cache")) {
    await Promise.all(BROWSER_CACHE_PATHS.map((relative) => fs.rm(path.join(profileDir, relative), REMOVE_OPTIONS)));
  }
  if (selected.has("converted-audio")) {
    const dirs = await readConvertedDirs(paths.userDataPath);
    await Promise.all(dirs.map((dir) => fs.rm(dir, REMOVE_OPTIONS)));
    await writeConvertedDirs(paths.userDataPath, []);
  }
  if (selected.has("logs")) await clearDirectoryContents(paths.logDir);
  if (selected.has("app-cache")) await hooks.clearAppCache();

  const usage = await getStorageUsage(paths);
  return { freedBytes: Math.max(0, before.totalBytes - usage.totalBytes), usage };
}
