const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("installer", {
  info: () => ipcRenderer.invoke("info"),
  check: (target) => ipcRenderer.invoke("check", target),
  choose: (current) => ipcRenderer.invoke("choose", current),
  install: (options) => ipcRenderer.invoke("install", options),
  uninstall: (options) => ipcRenderer.invoke("uninstall", options),
  cancel: () => ipcRenderer.send("cancel"),
  launch: () => ipcRenderer.send("launch"),
  quit: () => ipcRenderer.send("quit"),
  onProgress: (listener) => ipcRenderer.on("progress", (_event, progress) => listener(progress)),
});
