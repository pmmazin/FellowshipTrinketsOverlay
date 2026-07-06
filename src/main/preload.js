const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fellowshipOverlay", {
  chooseLogDirectory: () => ipcRenderer.invoke("choose-log-directory"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  setClickThrough: (enabled) => ipcRenderer.invoke("set-click-through", enabled),
  refresh: () => ipcRenderer.invoke("refresh"),
  onLogData: (callback) => ipcRenderer.on("log-data", (_event, payload) => callback(payload)),
  onWatchStatus: (callback) => ipcRenderer.on("watch-status", (_event, payload) => callback(payload)),
  onOverlayMode: (callback) => ipcRenderer.on("overlay-mode", (_event, payload) => callback(payload)),
  onOpenSettings: (callback) => ipcRenderer.on("open-settings", (_event, payload) => callback(payload)),
  onRefreshState: (callback) => ipcRenderer.on("refresh-state", (_event, payload) => callback(payload)),
});
