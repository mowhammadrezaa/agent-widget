const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("widget", {
  expand: () => ipcRenderer.send("widget:expand"),
  collapse: () => ipcRenderer.send("widget:collapse"),
  toggle: () => ipcRenderer.send("widget:toggle"),
  pin: (value) => ipcRenderer.send("widget:pin", value),
  restart: () => ipcRenderer.send("widget:restart"),
  getState: () => ipcRenderer.invoke("widget:get-state"),
  pickWorkspace: () => ipcRenderer.invoke("widget:pick-workspace"),
  onState: (cb) => {
    const listener = (_e, state) => cb(state);
    ipcRenderer.on("widget:state", listener);
    return () => ipcRenderer.removeListener("widget:state", listener);
  },
  write: (data) => ipcRenderer.send("pty:input", data),
  resize: (cols, rows) => ipcRenderer.send("pty:resize", { cols, rows }),
  onData: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on("pty:data", listener);
    return () => ipcRenderer.removeListener("pty:data", listener);
  },
  onClear: (cb) => {
    const listener = () => cb();
    ipcRenderer.on("pty:clear", listener);
    return () => ipcRenderer.removeListener("pty:clear", listener);
  },
});
