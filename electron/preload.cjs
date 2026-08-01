const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, cb) {
  ipcRenderer.removeAllListeners(channel);
  const listener = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("widget", {
  expand: () => ipcRenderer.send("widget:expand"),
  collapse: () => ipcRenderer.send("widget:collapse"),
  toggle: () => ipcRenderer.send("widget:toggle"),
  setAlwaysOnTop: (value) => ipcRenderer.send("widget:set-always-on-top", value),
  setOpenAtLogin: (value) => ipcRenderer.invoke("widget:set-open-at-login", value),
  restart: () => ipcRenderer.send("widget:restart"),
  setIgnoreMouse: (ignore) => ipcRenderer.send("widget:set-ignore-mouse", ignore),
  moveBy: (dx, dy) => ipcRenderer.send("widget:move-by", { dx, dy }),
  quit: () => ipcRenderer.send("widget:quit"),
  showPillMenu: () => ipcRenderer.send("widget:pill-menu"),
  setAgent: (id) => ipcRenderer.send("widget:set-agent", id),
  addAgent: (payload) => ipcRenderer.invoke("widget:add-agent", payload),
  removeAgent: (id) => ipcRenderer.invoke("widget:remove-agent", id),
  newTab: (agentId) => ipcRenderer.invoke("widget:new-tab", agentId),
  setTab: (id) => ipcRenderer.invoke("widget:set-tab", id),
  closeTab: (id) => ipcRenderer.invoke("widget:close-tab", id),
  closeAllTabs: () => ipcRenderer.invoke("widget:close-all-tabs"),
  replayTab: (id) => ipcRenderer.invoke("widget:replay-tab", id),
  getState: () => ipcRenderer.invoke("widget:get-state"),
  pickWorkspace: () => ipcRenderer.invoke("widget:pick-workspace"),
  onState: (cb) => subscribe("widget:state", cb),
  write: (data, tabId) => ipcRenderer.send("pty:input", { data, tabId }),
  resize: (cols, rows, tabId) => ipcRenderer.send("pty:resize", { cols, rows, tabId }),
  onData: (cb) => subscribe("pty:data", cb),
  onReset: (cb) => subscribe("pty:reset", cb),
});
