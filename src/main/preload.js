const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fellowshipOverlay", {
  chooseLogDirectory: () => ipcRenderer.invoke("choose-log-directory"),
  chooseInstallDirectory: () => ipcRenderer.invoke("choose-install-directory"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  setClickThrough: (enabled) => ipcRenderer.invoke("set-click-through", enabled),
  refresh: () => ipcRenderer.invoke("refresh"),
  updateApp: () => ipcRenderer.invoke("update-app"),
  onLogData: (callback) => ipcRenderer.on("log-data", (_event, payload) => callback(payload)),
  onWatchStatus: (callback) => ipcRenderer.on("watch-status", (_event, payload) => callback(payload)),
  onOverlayMode: (callback) => ipcRenderer.on("overlay-mode", (_event, payload) => callback(payload)),
  onOpenSettings: (callback) => ipcRenderer.on("open-settings", (_event, payload) => callback(payload)),
  onRefreshState: (callback) => ipcRenderer.on("refresh-state", (_event, payload) => callback(payload)),
  onCursorPosition: (callback) => ipcRenderer.on("cursor-position", (_event, payload) => callback(payload)),
  onUpdateState: (callback) => ipcRenderer.on("update-state", (_event, payload) => callback(payload)),
});
