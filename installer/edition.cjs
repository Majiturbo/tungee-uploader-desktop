// Lite is stamped at pack time (`extraMetadata.edition=lite` and/or productName 轻量版).
const pkg = require("./package.json");
const lite = pkg.edition === "lite" || String(pkg.productName || "").includes("轻量版");

module.exports = {
  lite,
  APP_NAME: lite ? "探迹话术上传助手轻量版" : "探迹话术上传助手",
  APP_ID: lite ? "com.tungee.uploader.lite" : "com.tungee.uploader",
  FOLDER: lite ? "TungeeUploaderLite" : "TungeeUploader",
  REG_KEY: lite
    ? "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\TungeeUploaderLite"
    : "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\TungeeUploader",
  USER_DATA: lite ? "tungee-uploader-desktop-lite" : "tungee-uploader-desktop",
  LOG_FOLDER: lite ? "TungeeUploaderLite" : "TungeeUploader",
  /** Payload folder that must exist before the wizard will install. Lite ships ASR only. */
  MODEL_DIR: lite ? ["resources", "models", "asr"] : ["resources", "models", "llm"],
};
