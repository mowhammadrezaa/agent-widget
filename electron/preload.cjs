const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, cb) {
  ipcRenderer.removeAllListeners(channel);
  const listener = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("widget", {
  expand: () => ipcRenderer.send("widget:expand"),
  collapse: (opts) => ipcRenderer.send("widget:collapse", opts || {}),
  toggle: () => ipcRenderer.send("widget:toggle"),
  pin: (value) => ipcRenderer.send("widget:pin", value),
  setAlwaysOnTop: (value) => ipcRenderer.send("widget:set-always-on-top", value),
  restart: () => ipcRenderer.send("widget:restart"),
  setIgnoreMouse: (ignore) => ipcRenderer.send("widget:set-ignore-mouse", ignore),
  moveBy: (dx, dy) => ipcRenderer.send("widget:move-by", { dx, dy }),
  quit: () => ipcRenderer.send("widget:quit"),
  showPillMenu: () => ipcRenderer.send("widget:pill-menu"),
  setAgent: (id) => ipcRenderer.send("widget:set-agent", id),
  addAgent: (payload) => ipcRenderer.invoke("widget:add-agent", payload),
  removeAgent: (id) => ipcRenderer.invoke("widget:remove-agent", id),
  getState: () => ipcRenderer.invoke("widget:get-state"),
  pickWorkspace: () => ipcRenderer.invoke("widget:pick-workspace"),
  onState: (cb) => subscribe("widget:state", cb),
  write: (data) => ipcRenderer.send("pty:input", data),
  resize: (cols, rows) => ipcRenderer.send("pty:resize", { cols, rows }),
  onData: (cb) => subscribe("pty:data", cb),
  onReset: (cb) => subscribe("pty:reset", cb),
});
