#!/usr/bin/env node
/**
 * Capture collapsed + expanded screenshots for the README.
 * Usage: node scripts/capture-screenshots.cjs
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs", "screenshots");
const COLLAPSED = { width: 280, height: 160 };
const EXPANDED = { width: 820, height: 560 };

app.commandLine.appendSwitch("enable-transparent-visuals");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function capture(win, file) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(file, img.toPNG());
  console.log("wrote", path.relative(ROOT, file));
}

app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    try {
      app.dock.hide();
    } catch {
      // ignore
    }
  }

  fs.mkdirSync(OUT, { recursive: true });

  const state = {
    expanded: false,
    alwaysOnTop: true,
    openAtLogin: false,
    workspace: path.join(os.homedir(), "Projects"),
    agentId: "cursor",
    agentLabel: "Cursor",
    agentCommand: "agent",
    agentCustom: false,
    agentPath: "agent",
    agents: [
      { id: "cursor", label: "Cursor", command: "agent", custom: false },
      { id: "claude", label: "Claude", command: "claude", custom: false },
    ],
    running: true,
  };

  const win = new BrowserWindow({
    width: COLLAPSED.width,
    height: COLLAPSED.height,
    x: 120,
    y: 120,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    backgroundColor: "#00000000",
    roundedCorners: false,
    webPreferences: {
      preload: path.join(ROOT, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  function sendState() {
    if (!win.isDestroyed()) win.webContents.send("widget:state", state);
  }

  ipcMain.on("widget:expand", () => {
    state.expanded = true;
    win.setBounds({ x: 120, y: 80, width: EXPANDED.width, height: EXPANDED.height }, false);
    sendState();
  });
  ipcMain.on("widget:collapse", () => {
    state.expanded = false;
    win.setBounds({ x: 120, y: 120, width: COLLAPSED.width, height: COLLAPSED.height }, false);
    sendState();
  });
  ipcMain.on("widget:set-ignore-mouse", () => {});
  ipcMain.on("widget:move-by", () => {});
  ipcMain.on("widget:quit", () => app.quit());
  ipcMain.on("widget:restart", () => {});
  ipcMain.on("widget:set-agent", () => {});
  ipcMain.on("widget:set-always-on-top", () => {});
  ipcMain.on("widget:pill-menu", () => {});
  ipcMain.on("pty:input", () => {});
  ipcMain.on("pty:resize", () => {});
  ipcMain.handle("widget:get-state", () => ({ ...state }));
  ipcMain.handle("widget:set-open-at-login", () => false);
  ipcMain.handle("widget:pick-workspace", () => state.workspace);
  ipcMain.handle("widget:add-agent", () => ({ ok: false }));
  ipcMain.handle("widget:remove-agent", () => ({ ok: false }));

  await win.loadFile(path.join(ROOT, "src", "index.html"));

  // Solid backdrop so transparent chrome reads well on GitHub
  await win.webContents.insertCSS(`
    html, body {
      background:
        radial-gradient(120% 80% at 10% 0%, rgba(183,243,92,0.08), transparent 50%),
        radial-gradient(90% 70% at 100% 100%, rgba(92,224,178,0.07), transparent 45%),
        linear-gradient(160deg, #121a17 0%, #070b09 100%) !important;
    }
    #app[data-mode="collapsed"] {
      -webkit-mask-image: none !important;
      mask-image: none !important;
    }
  `);

  win.showInactive();
  await sleep(1000);
  sendState();
  await sleep(700);

  // --- Collapsed pill ---
  state.expanded = false;
  state.running = false;
  win.setBounds({ x: 120, y: 120, width: COLLAPSED.width, height: COLLAPSED.height }, false);
  sendState();
  await sleep(600);
  await capture(win, path.join(OUT, "pill.png"));

  // --- Expanded panel ---
  state.expanded = true;
  state.running = true;
  win.setBounds({ x: 80, y: 60, width: EXPANDED.width, height: EXPANDED.height }, false);
  sendState();
  await sleep(1100);

  // Demo transcript into xterm (renderer keeps term in closure — drive via pty:data)
  const demo = [
    "\x1b[90m~/Projects/demo\x1b[0m\r\n\r\n",
    "\x1b[32m✓\x1b[0m Connected to Cursor Agent\r\n\r\n",
    "\x1b[1mHow do I keep a floating Electron widget above other windows?\x1b[0m\r\n\r\n",
    "Use \x1b[36mwin.setAlwaysOnTop(true, 'floating')\x1b[0m and optionally\r\n",
    "\x1b[36msetVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })\x1b[0m\r\n",
    "when you want it on every Space.\r\n\r\n",
    "\x1b[36magent\x1b[0m> ",
  ].join("");
  win.webContents.send("pty:data", demo);
  await sleep(500);
  await capture(win, path.join(OUT, "panel.png"));

  console.log("Done →", OUT);
  app.quit();
});
