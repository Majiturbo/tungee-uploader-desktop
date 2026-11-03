// Pure installer decisions, kept free of Electron and the real file system so they can be tested anywhere.
const path = require("node:path").win32;

const FOLDER = "TungeeUploader";
const GB = 1024 ** 3;
/** Room left over after installing, so the default never fills a drive to the brim. */
const MARGIN = GB;

/** Default location: the local fixed drive other than the system drive with the most free space that fits,
 * falling back to the per-user programs folder on the system drive. */
function pickDefaultPath({ drives, systemDrive, required, localAppData, writable, folder = FOLDER }) {
  const system = normalizeDrive(systemDrive);
  const best = drives
    .filter((drive) => normalizeDrive(drive.id) !== system && drive.free >= required + MARGIN && writable(`${normalizeDrive(drive.id)}\\`))
    .sort((a, b) => b.free - a.free)[0];
  if (best) return `${normalizeDrive(best.id)}\\${folder}`;
  return path.join(localAppData, "Programs", folder);
}

/** Where to install after the user picks a folder: our own install and empty folders are used as they are;
 * anything else, including a drive root, gets its own TungeeUploader subfolder. */
function resolveChosen(picked, { isOurs, isEmpty, folder = FOLDER }) {
  const folderPath = path.resolve(picked);
  const isRoot = path.parse(folderPath).root.toLowerCase() === `${folderPath.toLowerCase().replace(/\\+$/, "")}\\`;
  if (isOurs(folderPath)) return folderPath;
  if (!isRoot && isEmpty(folderPath)) return folderPath;
  if (path.basename(folderPath).toLowerCase() === folder.toLowerCase() && isEmpty(folderPath)) return folderPath;
  return path.join(folderPath, folder);
}

/** PowerShell's ConvertTo-Json turns one-element arrays into a bare object and omits empty ones. */
function parseProbe(text) {
  const data = JSON.parse(text || "{}");
  const list = data.drives == null ? [] : Array.isArray(data.drives) ? data.drives : [data.drives];
  return {
    drives: list
      .filter((drive) => typeof drive.id === "string")
      .map((drive) => ({ id: normalizeDrive(drive.id), free: Number(drive.free) || 0, total: Number(drive.size) || 0 })),
    existing: typeof data.existing === "string" && data.existing.trim() ? data.existing.trim() : null,
  };
}

function normalizeDrive(id) {
  return String(id).trim().replace(/\\+$/, "").toUpperCase();
}

function friendlyError(error) {
  const code = error && error.code;
  if (code === "ENOSPC") return "磁盘空间不够了，换个位置";
  if (code === "EPERM" || code === "EACCES") return "没有权限写入这个位置，换一个位置";
  if (code === "EBUSY") return "有文件被占用，关掉相关窗口后再试";
  if (code === "OCCUPIED") return "这个文件夹里有其他文件，换一个位置";
  if (code === "LOCKED") return "旧版本有文件被别的程序打开着，关掉那个程序后再试";
  if (code === "ENOENT") return "安装文件不完整，请重新解压压缩包";
  return `复制文件时出错${code ? `（${code}）` : ""}`;
}

module.exports = { FOLDER, GB, MARGIN, pickDefaultPath, resolveChosen, parseProbe, normalizeDrive, friendlyError };
