import type { AppEdition } from "../../shared/edition";
import type { DesktopApi } from "../../shared/types";

declare global {
  const __APP_VERSION__: string;
  const __APP_EDITION__: AppEdition;
  interface Window {
    tungee: DesktopApi;
  }
}

export {};
