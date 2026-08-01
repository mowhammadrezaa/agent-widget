/**
 * Verifies PTY → IPC({tabId,data}) → xterm round-trip.
 * Run: env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/verify-pty-io.cjs
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const pty = require("node-pty");

const ROOT = path.resolve(__dirname, "..");
const TAB = "tab-test";
let win = null;
let proc = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

app.whenReady().then(async () => {
  try {
    win = new BrowserWindow({
      width: 820,
      height: 560,
      show: false,
      webPreferences: {
        preload: path.join(ROOT, "electron", "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    ipcMain.handle("widget:get-state", () => ({
      expanded: true,
      alwaysOnTop: true,
      openAtLogin: false,
      workspace: process.env.HOME,
      agentId: "cursor",
      agentLabel: "Cursor",
      agentCommand: "agent",
      agentCustom: false,
      agentPath: "agent",
      agents: [{ id: "cursor", label: "Cursor", command: "agent", custom: false }],
      tabs: [{ id: TAB, agentId: "cursor", title: "Cursor", running: true }],
      activeTabId: TAB,
      running: true,
    }));
    for (const ch of [
      "widget:expand",
      "widget:collapse",
      "widget:toggle",
      "widget:restart",
      "widget:quit",
      "widget:pill-menu",
      "widget:set-always-on-top",
      "widget:set-ignore-mouse",
      "widget:move-by",
      "widget:set-agent",
    ]) {
      ipcMain.on(ch, () => {});
    }
    ipcMain.handle("widget:set-open-at-login", () => false);
    ipcMain.handle("widget:add-agent", () => ({ ok: false }));
    ipcMain.handle("widget:remove-agent", () => ({ ok: false }));
    ipcMain.handle("widget:new-tab", () => ({ ok: false }));
    ipcMain.handle("widget:set-tab", () => ({ ok: false }));
    ipcMain.handle("widget:close-tab", () => ({ ok: false }));
    ipcMain.handle("widget:close-all-tabs", () => ({ ok: false }));
    ipcMain.handle("widget:replay-tab", () => ({ ok: true }));
    ipcMain.handle("widget:pick-workspace", () => process.env.HOME);

    ipcMain.on("pty:input", (_e, payload) => {
      const data = payload?.data ?? payload;
      proc?.write(data);
    });
    ipcMain.on("pty:resize", () => {});

    await win.loadFile(path.join(__dirname, "verify-pty-io.html"));

    for (let i = 0; i < 50; i++) {
      const ready = await win.webContents.executeJavaScript(
        "Boolean(window.__ready && window.widget)",
      );
      if (ready) break;
      await sleep(50);
    }

    const hooked = await win.webContents.executeJavaScript(
      "Boolean(window.widget && typeof window.widget.onData === 'function')",
    );
    if (!hooked) {
      console.error("FAIL: preload widget API missing");
      app.exit(1);
      return;
    }

    // Start PTY only after renderer subscribed to pty:data.
    proc = pty.spawn(
      "/bin/zsh",
      [
        "-lc",
        'printf "READY\\n"; while IFS= read -r line; do printf "ECHO:%s\\n" "$line"; done',
      ],
      {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: process.env.HOME,
        env: process.env,
      },
    );
    proc.onData((data) => {
      const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
      win.webContents.send("pty:data", { tabId: TAB, data: text });
    });

    let painted = "";
    for (let i = 0; i < 100; i++) {
      painted = await win.webContents.executeJavaScript("window.__getPainted()");
      if (painted.includes("READY")) break;
      await sleep(50);
    }
    if (!painted.includes("READY")) {
      console.error("FAIL: never saw READY. painted=", JSON.stringify(painted));
      app.exit(1);
      return;
    }

    await win.webContents.executeJavaScript(
      `window.widget.write('hello-roundtrip\\n', '${TAB}')`,
    );

    for (let i = 0; i < 100; i++) {
      painted = await win.webContents.executeJavaScript("window.__getPainted()");
      if (painted.includes("ECHO:hello-roundtrip")) break;
      await sleep(50);
    }

    if (!painted.includes("ECHO:hello-roundtrip")) {
      console.error("FAIL: no echo. painted=", JSON.stringify(painted));
      app.exit(1);
      return;
    }

    console.log("PASS: PTY IPC round-trip works");
    console.log("painted=", JSON.stringify(painted.slice(0, 200)));
    try {
      proc.kill();
    } catch {
      // ignore
    }
    app.exit(0);
  } catch (err) {
    console.error("FAIL:", err);
    try {
      proc?.kill();
    } catch {
      // ignore
    }
    app.exit(1);
  }
});

app.on("window-all-closed", () => app.exit(0));
