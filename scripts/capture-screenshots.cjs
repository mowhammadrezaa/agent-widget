#!/usr/bin/env node
/**
 * Capture collapsed + expanded screenshots for the README.
 * Usage: node scripts/capture-screenshots.cjs
 *
 * Pill: opaque magenta chroma → knock out → crop to content (transparent PNG).
 * Panel: soft opaque backdrop so the full chrome reads on GitHub / dark previews.
 */
const { app, BrowserWindow, ipcMain, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs", "screenshots");
const COLLAPSED = { width: 240, height: 128 };
const EXPANDED = { width: 820, height: 560 };
const CHROMA = "#ff00ff";
const PANEL_BACKDROP = "#0e1512";

app.commandLine.appendSwitch("enable-transparent-visuals");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readPixel(src, width, x, y, bgra) {
  const i = (y * width + x) * 4;
  return {
    r: bgra ? src[i + 2] : src[i],
    g: src[i + 1],
    b: bgra ? src[i] : src[i + 2],
    a: src[i + 3],
    i,
  };
}

/**
 * Knock out near-chroma pixels (sampled from a corner — display color
 * management shifts pure #ff00ff) and crop to remaining opaque bounds.
 */
function chromaKeyAndCrop(img, tolerance = 72, pad = 4) {
  const { width, height } = img.getSize();
  const src = img.toBitmap(); // BGRA on macOS, RGBA elsewhere
  const bgra = process.platform === "darwin";
  const chroma = readPixel(src, width, 0, 0, bgra);
  const out = Buffer.alloc(src.length);
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let found = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = readPixel(src, width, x, y, bgra);
      const match =
        Math.abs(px.r - chroma.r) <= tolerance &&
        Math.abs(px.g - chroma.g) <= tolerance &&
        Math.abs(px.b - chroma.b) <= tolerance;

      if (match || px.a === 0) {
        out[px.i] = 0;
        out[px.i + 1] = 0;
        out[px.i + 2] = 0;
        out[px.i + 3] = 0;
        continue;
      }

      out[px.i] = src[px.i];
      out[px.i + 1] = src[px.i + 1];
      out[px.i + 2] = src[px.i + 2];
      out[px.i + 3] = px.a || 255;
      found = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (!found) {
    throw new Error(
      `chroma key matched every pixel (corner rgb=${chroma.r},${chroma.g},${chroma.b})`
    );
  }

  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const cropped = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcStart = ((minY + y) * width + minX) * 4;
    out.copy(cropped, y * cw * 4, srcStart, srcStart + cw * 4);
  }

  const keyed = nativeImage.createFromBitmap(cropped, {
    width: cw,
    height: ch,
    scaleFactor: 1,
  });
  const png = keyed.toPNG();
  // PNG color type 4 (gray+alpha) or 6 (RGBA) means we kept transparency.
  const colorType = png[25];
  if (colorType !== 4 && colorType !== 6) {
    throw new Error(`chroma-keyed PNG has no alpha (IHDR color type ${colorType})`);
  }
  return png;
}

async function captureRaw(win) {
  return win.webContents.capturePage();
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
    tabs: [{ id: "tab-demo", agentId: "cursor", title: "Cursor", running: true }],
    activeTabId: "tab-demo",
    running: true,
  };

  const win = new BrowserWindow({
    width: COLLAPSED.width,
    height: COLLAPSED.height,
    x: 120,
    y: 120,
    frame: false,
    transparent: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    backgroundColor: CHROMA,
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

  // Solid chroma behind the pill (mask off so the key color fills the frame).
  await win.webContents.insertCSS(`
    html, body, #app {
      background: ${CHROMA} !important;
    }
    #app[data-mode="collapsed"] {
      -webkit-mask-image: none !important;
      mask-image: none !important;
    }
    #pill, .orb {
      animation: none !important;
    }
  `);

  win.showInactive();
  await sleep(800);
  sendState();
  await sleep(500);

  // --- Collapsed pill (transparent PNG) ---
  state.expanded = false;
  state.running = false;
  win.setBackgroundColor(CHROMA);
  win.setBounds({ x: 120, y: 120, width: COLLAPSED.width, height: COLLAPSED.height }, false);
  sendState();
  await sleep(500);

  const pillShot = await captureRaw(win);
  const pillPng = chromaKeyAndCrop(pillShot);
  const pillPath = path.join(OUT, "pill.png");
  fs.writeFileSync(pillPath, pillPng);
  const pillSize = nativeImage.createFromBuffer(pillPng).getSize();
  console.log("wrote", path.relative(ROOT, pillPath), `${pillSize.width}x${pillSize.height}`);

  // --- Expanded panel (opaque backdrop) ---
  await win.webContents.insertCSS(`
    html, body {
      background:
        radial-gradient(120% 80% at 10% 0%, rgba(183,243,92,0.10), transparent 50%),
        radial-gradient(90% 70% at 100% 100%, rgba(92,224,178,0.08), transparent 45%),
        linear-gradient(160deg, #15201b 0%, #0e1512 100%) !important;
    }
  `);
  win.setBackgroundColor(PANEL_BACKDROP);
  state.expanded = true;
  state.running = true;
  win.setBounds({ x: 80, y: 60, width: EXPANDED.width, height: EXPANDED.height }, false);
  sendState();
  await sleep(1100);

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

  const panelShot = await captureRaw(win);
  const panelPath = path.join(OUT, "panel.png");
  fs.writeFileSync(panelPath, panelShot.toPNG());
  console.log(
    "wrote",
    path.relative(ROOT, panelPath),
    `${panelShot.getSize().width}x${panelShot.getSize().height}`
  );

  console.log("Done →", OUT);
  app.quit();
});
