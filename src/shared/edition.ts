/** Build-time edition. Lite omits the local LLM; ASR and upload stay. */
export type AppEdition = "standard" | "lite";

declare const __APP_EDITION__: AppEdition | undefined;

export const APP_EDITION: AppEdition =
  typeof __APP_EDITION__ !== "undefined" && __APP_EDITION__ === "lite" ? "lite" : "standard";

export const isLite = (): boolean => APP_EDITION === "lite";

export const PRODUCT_NAME = "探迹话术上传助手";
export const EDITION_ZH = isLite() ? "轻量版" : "标准版";
export const WINDOW_TITLE = isLite() ? `${PRODUCT_NAME} · 轻量版` : PRODUCT_NAME;

/** Shown next to the Chinese edition name so the build is obviously not Standard. */
export const LITE_BADGE = "Lite";

export const LITE_LLM_UNAVAILABLE = "轻量版不含本地大模型";

export function versionLabel(version: string): string {
  return isLite() ? `${version} · 轻量版 Lite` : version;
}

export function editionBlurb(): string {
  return isLite()
    ? "轻量版保留语音识别与上传，不含本地大模型（AI 补问法、查错字、AI 意向归类）。需要这些能力请用标准版。"
    : "标准版含本地语音识别与本地大模型，AI 建议均在本机运行、不联网。";
}
