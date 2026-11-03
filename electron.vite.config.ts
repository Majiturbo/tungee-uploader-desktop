import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const edition = process.env.TUNGE_EDITION === "lite" ? "lite" : "standard";
const sharedDefine = {
  __APP_EDITION__: JSON.stringify(edition),
};

export default defineConfig({
  main: {
    define: sharedDefine,
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          sidecar: resolve("src/main/sidecar.ts"),
          // Keep the worker as its own file even in Lite. LocalLlm forks it, looking next to the
          // bundle and one folder up, because shared main code is emitted under out/main/chunks/.
          "llm-worker": resolve("src/main/llm-worker.ts"),
        },
      },
    },
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
      },
    },
  },
  preload: {
    define: sharedDefine,
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          "audio-worker": resolve("src/preload/audio-worker.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
      },
    },
  },
  renderer: {
    define: {
      ...sharedDefine,
      __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync("package.json", "utf8")).version),
    },
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [react()],
  },
});
