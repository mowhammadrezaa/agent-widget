const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execSync } = require("child_process");
const pty = require("node-pty");

const COLLAPSED = { width: 172, height: 52 };
const EXPANDED = { width: 820, height: 560 };
const MARGIN = 24;
const CONFIG_PATH = path.join(os.homedir(), ".cursor-agent-widget.json");

let win = null;
let tray = null;
let ptyProcess = null;
let expanded = false;
let pinned = false;
let workspace = process.env.HOME || os.homedir();

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (raw.workspace && fs.existsSync(raw.workspace)) {
      workspace = raw.workspace;
    }
  } catch {
    // first run
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify({ workspace }, null, 2) + "\n",
      "utf8",
    );
  } catch {
    // ignore
  }
}
function resolveAgentPath() {
  const candidates = [
    process.env.CURSOR_AGENT_PATH,
    path.join(os.homedir(), ".local", "bin", "agent"),
    path.join(os.homedir(), ".local", "bin", "cursor-agent"),
    "/opt/homebrew/bin/agent",
    "/usr/local/bin/agent",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // keep looking
    }
  }

  try {
    const found = execSync("zsh -lc 'command -v agent || command -v cursor-agent'", {
      encoding: "utf8",
    }).trim();
    if (found) return found;
  } catch {
    // ignore
  }

  return "agent";
}

function cornerBounds(size) {
  const display = screen.getPrimaryDisplay();
  const work = display.workArea;
  return {
    x: Math.round(work.x + work.width - size.width - MARGIN),
    y: Math.round(work.y + work.height - size.height - MARGIN),
    width: size.width,
    height: size.height,
  };
}

function createWindow() {
  const bounds = cornerBounds(COLLAPSED);

  win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    backgroundColor: "#00000000",
    vibrancy: "under-window",
    visualEffectState: "active",
    titleBarStyle: "customButtonsOnHover",
    trafficLightPosition: { x: -100, y: -100 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setHiddenInMissionControl(true);

  win.loadFile(path.join(__dirname, "..", "src", "index.html"));

  win.once("ready-to-show", () => {
    win.showInactive();
    sendState();
  });

  win.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      setExpanded(false);
      win.hide();
    }
  });

  win.on("closed", () => {
    killPty();
    win = null;
  });

  win.on("blur", () => {
    if (!pinned && expanded) {
      setTimeout(() => {
        if (win && !win.isDestroyed() && !win.isFocused() && !pinned && expanded) {
          setExpanded(false);
        }
      }, 450);
    }
  });
}

function sendState() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("widget:state", {
    expanded,
    pinned,
    workspace,
    agentPath: resolveAgentPath(),
    running: Boolean(ptyProcess),
  });
}

function setExpanded(next) {
  if (!win || win.isDestroyed()) return;
  if (expanded === next) {
    sendState();
    return;
  }

  expanded = next;
  const size = expanded ? EXPANDED : COLLAPSED;
  const bounds = cornerBounds(size);
  win.setBounds(bounds, true);
  win.setResizable(expanded);
  sendState();

  if (expanded) {
    ensurePty();
    win.focus();
  }
}

function setPinned(next) {
  pinned = Boolean(next);
  sendState();
}

function killPty() {
  if (!ptyProcess) return;
  try {
    ptyProcess.kill();
  } catch {
    // already dead
  }
  ptyProcess = null;
}

function ensurePty() {
  if (ptyProcess) return;

  const agentPath = resolveAgentPath();
  const cols = 100;
  const rows = 32;

  const env = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    FORCE_COLOR: "1",
  };

  // Prefer a login shell PATH so agent resolves the same way as Terminal.app.
  try {
    const shellPath = execSync("zsh -lc 'printenv PATH'", { encoding: "utf8" }).trim();
    if (shellPath) env.PATH = shellPath;
  } catch {
    // keep existing PATH
  }

  try {
    ptyProcess = pty.spawn(agentPath, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: workspace,
      env,
    });
  } catch (err) {
    win?.webContents.send(
      "pty:data",
      `\r\n\x1b[31mFailed to start agent:\x1b[0m ${err.message}\r\n` +
        `Looked for: ${agentPath}\r\n` +
        `Install the Cursor CLI, then click Restart.\r\n`,
    );
    return;
  }

  ptyProcess.onData((data) => {
    win?.webContents.send("pty:data", data);
  });

  ptyProcess.onExit(({ exitCode }) => {
    ptyProcess = null;
    win?.webContents.send(
      "pty:data",
      `\r\n\x1b[90magent exited (${exitCode ?? "?"}). Click Restart or expand again.\x1b[0m\r\n`,
    );
    sendState();
  });

  sendState();
}

function writePty(data) {
  if (!ptyProcess) ensurePty();
  ptyProcess?.write(data);
}

function resizePty(cols, rows) {
  if (!ptyProcess) return;
  try {
    ptyProcess.resize(Math.max(20, cols), Math.max(5, rows));
  } catch {
    // ignore
  }
}

function restartPty() {
  killPty();
  if (win && !win.isDestroyed()) {
    win.webContents.send("pty:clear");
  }
  ensurePty();
}

function createTray() {
  // Minimal 16x16 PNG (green dot) encoded as base64 — no external asset needed.
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAPUlEQVQ4T2NkYGD4z0ABYBzVMKoBBgYGBob/UAaTAcXG/xkwACaGmYGBgYERrysYKTUAph/FYFQD0DYAALq/AxG1QvK0AAAAAElFTkSuQmCC";
  const image = nativeImage.createFromDataURL(`data:image/png;base64,${pngBase64}`);
  image.setTemplateImage(true);

  tray = new Tray(image);
  tray.setToolTip("Cursor Agent Widget");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show Agent",
        click: () => {
          if (!win) createWindow();
          setExpanded(true);
          win?.show();
          win?.focus();
        },
      },
      {
        label: "Collapse",
        click: () => setExpanded(false),
      },
      { type: "separator" },
      {
        label: "Restart Agent",
        click: () => restartPty(),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => app.quit(),
      },
    ]),
  );

  tray.on("click", () => {
    if (!win) createWindow();
    setExpanded(!expanded);
    win?.show();
  });
}

function registerIpc() {
  ipcMain.on("widget:expand", () => setExpanded(true));
  ipcMain.on("widget:collapse", () => {
    if (!pinned) setExpanded(false);
  });
  ipcMain.on("widget:toggle", () => setExpanded(!expanded));
  ipcMain.on("widget:pin", (_e, value) => setPinned(value));
  ipcMain.on("widget:restart", () => restartPty());
  ipcMain.handle("widget:get-state", () => ({
    expanded,
    pinned,
    workspace,
    agentPath: resolveAgentPath(),
    running: Boolean(ptyProcess),
  }));
  ipcMain.on("pty:input", (_e, data) => writePty(data));
  ipcMain.on("pty:resize", (_e, { cols, rows }) => resizePty(cols, rows));
  ipcMain.handle("widget:pick-workspace", async () => {
    const { dialog } = require("electron");
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory", "createDirectory"],
      defaultPath: workspace,
    });
    if (!result.canceled && result.filePaths[0]) {
      workspace = result.filePaths[0];
      saveConfig();
      restartPty();
      sendState();
    }
    return workspace;
  });
}

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    app.dock.hide();
  }

  loadConfig();
  registerIpc();
  createWindow();
  createTray();

  globalShortcut.register("CommandOrControl+Shift+A", () => {
    if (!win) createWindow();
    if (win.isVisible() && expanded) {
      setExpanded(false);
    } else {
      win.show();
      setExpanded(true);
      win.focus();
    }
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  killPty();
});

app.on("window-all-closed", () => {
  // Stay alive in the menu bar tray.
});
