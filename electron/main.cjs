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
const pty = require("node-pty");
const startup = require("../scripts/startup-lib.cjs");

// Must be set before ready — helps macOS punch true per-pixel transparency.
app.commandLine.appendSwitch("enable-transparent-visuals");

// Collapsed shell must stay above macOS's ~128px transparency floor (height
// especially). The visible chrome is only the capsule; the rest is masked out.
const EXPANDED = { width: 820, height: 560 };
const COLLAPSED = { width: 240, height: 128 };
const PILL = { width: 228, height: 64 };
const MARGIN = 24;
const CONFIG_PATH = path.join(os.homedir(), ".agent-widget.json");
const BUFFER_PATH = path.join(os.homedir(), ".agent-widget-buffers.json");

const BUILTIN_AGENTS = {
  cursor: {
    id: "cursor",
    label: "Cursor",
    command: "agent",
    custom: false,
    candidates: [
      () => process.env.CURSOR_AGENT_PATH,
      () => path.join(os.homedir(), ".local", "bin", "agent"),
      () => path.join(os.homedir(), ".local", "bin", "cursor-agent"),
      () => "/opt/homebrew/bin/agent",
      () => "/usr/local/bin/agent",
    ],
    which: "command -v agent || command -v cursor-agent",
    installHint: "Install the Cursor CLI (`agent`), then click Restart.",
  },
  claude: {
    id: "claude",
    label: "Claude",
    command: "claude",
    custom: false,
    candidates: [
      () => process.env.CLAUDE_PATH,
      () => path.join(os.homedir(), ".local", "bin", "claude"),
      () => "/opt/homebrew/bin/claude",
      () => "/usr/local/bin/claude",
    ],
    which: "command -v claude",
    installHint: "Install Claude Code (`claude`), then click Restart.",
  },
};

let win = null;
let tray = null;
/** @type {Map<string, { process: import("node-pty").IPty, dataDisposable: any, exitDisposable: any }>} */
const ptys = new Map();
/** Soft scrollback per tab so switching tabs can replay output. */
const ptyBuffers = new Map();
const PTY_BUFFER_MAX = 200_000;
let expanded = false;
let alwaysOnTop = true;
let workspace = process.env.HOME || os.homedir();
let agentId = "cursor";
let customAgents = [];
/** @type {{ id: string, agentId: string }[]} */
let tabs = [];
let activeTabId = null;
/** Stable pill screen rect — survives expand clamp so collapse doesn't jump. */
let savedPillScreen = null;
/** Cached PATH / agent binaries — avoid sync `zsh -lc` (loads full shell, freezes UI). */
let cachedEnvPath = null;
const agentPathCache = new Map();

function newTabId() {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function syncAgentIdFromActiveTab() {
  const tab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  agentId = tab?.agentId || "cursor";
  if (tab) activeTabId = tab.id;
}

function ensureDefaultTabs() {
  if (!tabs.length) {
    const id = newTabId();
    tabs = [{ id, agentId: findAgent(agentId) ? agentId : "cursor" }];
    activeTabId = id;
  }
  if (!tabs.some((t) => t.id === activeTabId)) {
    activeTabId = tabs[0].id;
  }
  syncAgentIdFromActiveTab();
}

function tabTitle(tab) {
  const agent = getAgent(tab.agentId);
  const same = tabs.filter((t) => t.agentId === tab.agentId);
  if (same.length <= 1) return agent.label;
  const n = same.findIndex((t) => t.id === tab.id) + 1;
  return `${agent.label} ${n}`;
}

function listTabs() {
  return tabs.map((t) => ({
    id: t.id,
    agentId: t.agentId,
    title: tabTitle(t),
    running: Boolean(ptys.get(t.id)?.process),
  }));
}

function activeTab() {
  return tabs.find((t) => t.id === activeTabId) || tabs[0] || null;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) createWindow();
    win?.show();
    setExpanded(true);
    win?.focus();
  });
}

function listAgents() {
  return [
    ...Object.values(BUILTIN_AGENTS),
    ...customAgents,
  ].map((a) => ({
    id: a.id,
    label: a.label,
    command: a.command,
    custom: Boolean(a.custom),
  }));
}

function findAgent(id) {
  if (BUILTIN_AGENTS[id]) return BUILTIN_AGENTS[id];
  return customAgents.find((a) => a.id === id) || null;
}

function getAgent(id = agentId) {
  return findAgent(id) || BUILTIN_AGENTS.cursor;
}

function currentAgent() {
  return getAgent(agentId);
}

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (raw.workspace && fs.existsSync(raw.workspace)) {
      workspace = raw.workspace;
    }
    if (Array.isArray(raw.customAgents)) {
      customAgents = raw.customAgents
        .filter((a) => a && typeof a.command === "string" && a.command.trim())
        .map((a) => ({
          id: String(a.id || `custom-${Date.now()}`),
          label: String(a.label || a.command.trim().split(/\s+/)[0] || "Custom"),
          command: String(a.command).trim(),
          custom: true,
          installHint: `Could not run \`${String(a.command).trim()}\`. Check the command and click Restart.`,
        }));
    }
    if (raw.agentId && findAgent(raw.agentId)) {
      agentId = raw.agentId;
    }
    if (typeof raw.alwaysOnTop === "boolean") {
      alwaysOnTop = raw.alwaysOnTop;
    }
    if (Array.isArray(raw.tabs) && raw.tabs.length) {
      tabs = raw.tabs
        .filter((t) => t && t.id)
        .map((t) => ({
          id: String(t.id),
          agentId: findAgent(t.agentId) ? String(t.agentId) : "cursor",
        }));
      if (raw.activeTabId && tabs.some((t) => t.id === raw.activeTabId)) {
        activeTabId = String(raw.activeTabId);
      } else {
        activeTabId = tabs[0]?.id || null;
      }
    }
  } catch {
    // first run
  }
  ensureDefaultTabs();
  loadBuffers();
}

function saveConfig() {
  try {
    syncAgentIdFromActiveTab();
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify(
        {
          workspace,
          agentId,
          alwaysOnTop,
          activeTabId,
          tabs: tabs.map((t) => ({
            id: t.id,
            agentId: t.agentId,
          })),
          customAgents: customAgents.map((a) => ({
            id: a.id,
            label: a.label,
            command: a.command,
          })),
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  } catch {
    // ignore
  }
}

function loadBuffers() {
  try {
    const raw = JSON.parse(fs.readFileSync(BUFFER_PATH, "utf8"));
    if (!raw || typeof raw !== "object") return;
    const keep = new Set(tabs.map((t) => t.id));
    for (const [id, text] of Object.entries(raw)) {
      if (!keep.has(id) || typeof text !== "string" || !text) continue;
      ptyBuffers.set(
        id,
        text.length > PTY_BUFFER_MAX ? text.slice(text.length - PTY_BUFFER_MAX) : text,
      );
    }
  } catch {
    // no buffers yet
  }
}

let bufferSaveTimer = null;

function saveBuffersSoon() {
  clearTimeout(bufferSaveTimer);
  bufferSaveTimer = setTimeout(() => {
    bufferSaveTimer = null;
    saveBuffersNow();
  }, 750);
}

function saveBuffersNow() {
  clearTimeout(bufferSaveTimer);
  bufferSaveTimer = null;
  try {
    const keep = new Set(tabs.map((t) => t.id));
    const out = {};
    for (const [id, text] of ptyBuffers) {
      if (!keep.has(id) || !text) continue;
      out[id] = text;
    }
    fs.writeFileSync(BUFFER_PATH, JSON.stringify(out) + "\n", "utf8");
  } catch {
    // ignore
  }
}

function getEnvPath() {
  if (cachedEnvPath) return cachedEnvPath;
  const extras = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    path.join(os.homedir(), ".local", "bin"),
    path.join(os.homedir(), ".cursor", "bin"),
    path.join(os.homedir(), ".claude", "bin"),
  ];
  const merged = [...extras, ...(process.env.PATH || "").split(":")].filter(Boolean);
  cachedEnvPath = [...new Set(merged)].join(":");
  return cachedEnvPath;
}

function findOnPath(binName) {
  if (!binName || binName.includes("/") || binName.includes("\\")) return "";
  for (const dir of getEnvPath().split(":")) {
    const full = path.join(dir, binName);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    } catch {
      // keep looking
    }
  }
  return "";
}

function clearAgentPathCache() {
  agentPathCache.clear();
}

function resolveAgentPath(id = agentId) {
  if (agentPathCache.has(id)) return agentPathCache.get(id);

  const spec = getAgent(id);
  let resolved = spec.command;

  if (spec.custom) {
    const cmd = spec.command.trim();
    const bin = cmd.split(/\s+/)[0];
    if (path.isAbsolute(bin) && fs.existsSync(bin)) {
      resolved = bin;
    } else {
      resolved = findOnPath(bin) || bin;
    }
  } else {
    const candidates = (spec.candidates || []).map((fn) => fn()).filter(Boolean);
    let found = "";
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          found = candidate;
          break;
        }
      } catch {
        // keep looking
      }
    }
    if (!found) {
      for (const name of [spec.command, "cursor-agent"]) {
        found = findOnPath(name);
        if (found) break;
      }
    }
    resolved = found || spec.command;
  }

  agentPathCache.set(id, resolved);
  return resolved;
}

function setAgentId(nextId) {
  if (!findAgent(nextId)) {
    sendState();
    return;
  }
  const active = activeTab();
  // Same agent as the current tab — nothing to do.
  if (active?.agentId === nextId) {
    sendState();
    return;
  }
  // Switching agent opens a new tab; keep the current session intact.
  createTab(nextId);
}

function addCustomAgent({ command, label } = {}) {
  const cmd = String(command || "").trim();
  if (!cmd) {
    return { ok: false, error: "Command is required" };
  }
  const id = `custom-${Date.now().toString(36)}`;
  const name = String(label || cmd.split(/\s+/)[0] || "Custom").trim();
  const entry = {
    id,
    label: name,
    command: cmd,
    custom: true,
    installHint: `Could not run \`${cmd}\`. Check the command and click Restart.`,
  };
  customAgents.push(entry);
  // Open a new tab for the new agent so existing sessions stay put.
  const tabId = newTabId();
  tabs.push({ id: tabId, agentId: id });
  activeTabId = tabId;
  syncAgentIdFromActiveTab();
  saveConfig();
  clearAgentPathCache();
  if (expanded) {
    setImmediate(() => ensurePty(tabId));
  }
  sendState();
  return { ok: true, id, tabId };
}

function removeCustomAgent(id) {
  const idx = customAgents.findIndex((a) => a.id === id);
  if (idx < 0) return { ok: false, error: "Not a custom agent" };
  customAgents.splice(idx, 1);
  // Keep tabs; retarget any that used the removed agent.
  for (const tab of tabs) {
    if (tab.agentId === id) {
      tab.agentId = "cursor";
      restartPty(tab.id);
    }
  }
  syncAgentIdFromActiveTab();
  saveConfig();
  clearAgentPathCache();
  sendState();
  return { ok: true };
}

function createTab(preferredAgentId) {
  ensureDefaultTabs();
  const aid =
    (preferredAgentId && findAgent(preferredAgentId) && preferredAgentId) ||
    activeTab()?.agentId ||
    "cursor";
  const id = newTabId();
  tabs.push({ id, agentId: aid });
  activeTabId = id;
  syncAgentIdFromActiveTab();
  saveConfig();
  if (expanded) {
    setImmediate(() => ensurePty(id));
  }
  sendState();
  return { ok: true, id };
}

function setActiveTab(id) {
  if (!tabs.some((t) => t.id === id)) {
    return { ok: false, error: "Unknown tab" };
  }
  if (activeTabId === id) {
    sendState();
    return { ok: true, id };
  }
  activeTabId = id;
  syncAgentIdFromActiveTab();
  saveConfig();
  if (expanded) {
    setImmediate(() => ensurePty(id));
  }
  sendState();
  return { ok: true, id };
}

function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx < 0) return { ok: false, error: "Unknown tab" };

  killPty(id);
  clearPtyBuffer(id);
  tabs.splice(idx, 1);

  if (!tabs.length) {
    const fresh = newTabId();
    const aid = findAgent(agentId) ? agentId : "cursor";
    tabs = [{ id: fresh, agentId: aid }];
    activeTabId = fresh;
  } else if (activeTabId === id) {
    activeTabId = tabs[Math.min(idx, tabs.length - 1)].id;
  }

  syncAgentIdFromActiveTab();
  saveConfig();
  win?.webContents.send("pty:reset", { tabId: id });
  sendState();
  if (expanded) {
    setImmediate(() => {
      ensurePty(activeTabId);
      replayPtyBuffer(activeTabId);
    });
  }
  return { ok: true };
}

function closeAllTabs() {
  const aid = activeTab()?.agentId || (findAgent(agentId) ? agentId : "cursor");
  for (const tab of [...tabs]) {
    killPty(tab.id);
    clearPtyBuffer(tab.id);
  }
  const id = newTabId();
  tabs = [{ id, agentId: aid }];
  activeTabId = id;
  syncAgentIdFromActiveTab();
  saveConfig();
  win?.webContents.send("pty:reset", { all: true });
  sendState();
  if (expanded) {
    setImmediate(() => ensurePty(id));
  }
  return { ok: true, id };
}

function currentSize() {
  return expanded ? EXPANDED : COLLAPSED;
}

function pillOffsetInCollapsed() {
  return {
    x: Math.round((COLLAPSED.width - PILL.width) / 2),
    y: Math.round((COLLAPSED.height - PILL.height) / 2),
  };
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

/** Current on-screen pill rect from the live window (collapsed only). */
function readCollapsedPillScreen() {
  if (!win || win.isDestroyed()) {
    const b = cornerBounds(COLLAPSED);
    const o = pillOffsetInCollapsed();
    return { x: b.x + o.x, y: b.y + o.y, width: PILL.width, height: PILL.height };
  }
  const b = win.getBounds();
  const o = pillOffsetInCollapsed();
  return { x: b.x + o.x, y: b.y + o.y, width: PILL.width, height: PILL.height };
}

function rememberPillScreen(rect) {
  if (!rect) return;
  savedPillScreen = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: PILL.width,
    height: PILL.height,
  };
}

function clampPillScreen(rect) {
  const work = screen.getDisplayNearestPoint({
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height / 2),
  }).workArea;
  const maxX = work.x + work.width - PILL.width;
  const maxY = work.y + work.height - PILL.height;
  return {
    x: Math.round(Math.min(Math.max(rect.x, work.x), Math.max(work.x, maxX))),
    y: Math.round(Math.min(Math.max(rect.y, work.y), Math.max(work.y, maxY))),
    width: PILL.width,
    height: PILL.height,
  };
}

/**
 * Clamp so the *visible* chrome stays inside the display work area
 * (excludes menu bar and Dock). Collapsed: clamp the pill; shell may
 * overhang slightly so the capsule can reach the true edges.
 */
function clampBounds(x, y, width, height) {
  const center = {
    x: Math.round(x + width / 2),
    y: Math.round(y + height / 2),
  };
  const work = screen.getDisplayNearestPoint(center).workArea;

  if (!expanded) {
    const o = pillOffsetInCollapsed();
    const visX = x + o.x;
    const visY = y + o.y;
    const maxVisX = work.x + work.width - PILL.width;
    const maxVisY = work.y + work.height - PILL.height;
    const clampedVisX = Math.min(Math.max(visX, work.x), Math.max(work.x, maxVisX));
    const clampedVisY = Math.min(Math.max(visY, work.y), Math.max(work.y, maxVisY));
    return {
      x: Math.round(clampedVisX - o.x),
      y: Math.round(clampedVisY - o.y),
      width,
      height,
    };
  }

  const maxX = work.x + work.width - width;
  const maxY = work.y + work.height - height;
  return {
    x: Math.round(Math.min(Math.max(x, work.x), Math.max(work.x, maxX))),
    y: Math.round(Math.min(Math.max(y, work.y), Math.max(work.y, maxY))),
    width,
    height,
  };
}

function setWindowPositionClamped(x, y) {
  if (!win || win.isDestroyed()) return;
  const { width, height } = currentSize();
  const next = clampBounds(x, y, width, height);
  win.setPosition(next.x, next.y);
}

function placeExpandedFromPill(pill) {
  // Grow upward/left from the pill so opening near the top still feels natural.
  let x = pill.x + pill.width - EXPANDED.width;
  let y = pill.y + pill.height - EXPANDED.height;
  return clampBounds(x, y, EXPANDED.width, EXPANDED.height);
}

function placeCollapsedFromPill(pill) {
  const o = pillOffsetInCollapsed();
  return clampBounds(pill.x - o.x, pill.y - o.y, COLLAPSED.width, COLLAPSED.height);
}

function applyMousePassthrough() {
  if (!win || win.isDestroyed()) return;
  // Expanded: always receive clicks.
  if (expanded) {
    win.setIgnoreMouseEvents(false);
    return;
  }
  // Click-through for the transparent shell only works reliably while
  // always-on-top: otherwise macOS never delivers the hover that re-arms
  // the pill, and clicks fall through to the desktop forever.
  if (!alwaysOnTop) {
    win.setIgnoreMouseEvents(false);
    return;
  }
  win.setIgnoreMouseEvents(true, { forward: true });
}

function armPillHits() {
  if (!win || win.isDestroyed() || expanded) return;
  win.setIgnoreMouseEvents(false);
  // Raise without locking always-on-top, so a buried pill can be clicked.
  if (!alwaysOnTop) {
    try {
      win.moveTop();
    } catch {
      // ignore
    }
  }
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
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop,
    hasShadow: false,
    show: false,
    backgroundColor: "#00000000",
    roundedCorners: false,
    thickFrame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  applyAlwaysOnTop();
  win.setHiddenInMissionControl(true);
  win.setBackgroundColor("#00000000");
  // Clear any residual system material.
  try {
    win.setVibrancy(null);
  } catch {
    // ignore
  }

  win.loadFile(path.join(__dirname, "..", "src", "index.html"));

  win.once("ready-to-show", () => {
    win.showInactive();
    rememberPillScreen(readCollapsedPillScreen());
    applyMousePassthrough();
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
    killAllPtys();
    win = null;
  });

  // Don't auto-collapse on blur — native <select> menus and folder dialogs
  // steal focus and would instantly minimize the panel.

  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "Escape" && expanded) {
      event.preventDefault();
      requestCollapse();
    }
  });
}

function requestCollapse() {
  if (!expanded) return;
  setExpanded(false);
}

function applyAlwaysOnTop() {
  if (!win || win.isDestroyed()) return;
  if (alwaysOnTop) {
    win.setAlwaysOnTop(true, "floating");
    // Follow the user across Spaces and over fullscreen apps.
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    win.setAlwaysOnTop(false);
    // Stay on the current desktop only — do not overlay fullscreen /
    // maximized-to-new-Space apps.
    win.setVisibleOnAllWorkspaces(false);
  }
}

function setAlwaysOnTopEnabled(next) {
  alwaysOnTop = Boolean(next);
  applyAlwaysOnTop();
  applyMousePassthrough();
  if (!alwaysOnTop && !expanded) {
    // Make sure the collapsed pill is immediately clickable again.
    armPillHits();
  }
  saveConfig();
  rebuildTrayMenu();
  sendState();
}

function isOpenAtLoginEnabled() {
  if (app.isPackaged) {
    return Boolean(app.getLoginItemSettings().openAtLogin);
  }
  return startup.isOpenAtLogin();
}

function sendState() {
  if (!win || win.isDestroyed()) return;
  syncAgentIdFromActiveTab();
  const spec = currentAgent();
  const activePty = activeTabId ? ptys.get(activeTabId) : null;
  win.webContents.send("widget:state", {
    expanded,
    alwaysOnTop,
    openAtLogin: isOpenAtLoginEnabled(),
    workspace,
    agentId,
    agentLabel: spec.label,
    agentCommand: spec.command,
    agentCustom: Boolean(spec.custom),
    agentPath: resolveAgentPath(agentId),
    agents: listAgents(),
    tabs: listTabs(),
    activeTabId,
    running: Boolean(activePty?.process),
  });
}

function setOpenAtLoginEnabled(next) {
  try {
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: Boolean(next) });
    } else {
      startup.setOpenAtLogin(Boolean(next));
    }
  } catch (err) {
    const { dialog } = require("electron");
    dialog.showErrorBox(
      "Could not update login item",
      String(err?.message || err),
    );
  }
  rebuildTrayMenu();
  sendState();
  return isOpenAtLoginEnabled();
}

function setExpanded(next) {
  if (!win || win.isDestroyed()) return;
  if (expanded === next) {
    sendState();
    return;
  }

  if (next) {
    // Remember where the pill is *before* the panel is clamped on-screen.
    rememberPillScreen(readCollapsedPillScreen());
    expanded = true;
    win.setBounds(placeExpandedFromPill(savedPillScreen), false);
    win.setBackgroundColor("#00000000");
    applyMousePassthrough();
    sendState();
    win.focus();
    // Spawn after the panel is on screen — pty.spawn is sync and freezes expand.
    setImmediate(() => {
      if (!expanded || !win || win.isDestroyed()) return;
      ensurePty(activeTabId);
    });
  } else {
    // Always restore the pre-expand pill spot (not the panel center).
    const target = clampPillScreen(savedPillScreen || readCollapsedPillScreen());
    rememberPillScreen(target);
    expanded = false;
    win.setBounds(placeCollapsedFromPill(target), false);
    win.setBackgroundColor("#00000000");
    applyMousePassthrough();
    sendState();
  }
}

function appendPtyBuffer(tabId, text) {
  if (!tabId || !text) return;
  const prev = ptyBuffers.get(tabId) || "";
  const next = prev + text;
  ptyBuffers.set(
    tabId,
    next.length > PTY_BUFFER_MAX ? next.slice(next.length - PTY_BUFFER_MAX) : next,
  );
  saveBuffersSoon();
}

function clearPtyBuffer(tabId) {
  if (tabId) ptyBuffers.delete(tabId);
  saveBuffersSoon();
}

function sendPtyData(tabId, text) {
  if (!tabId || text == null || text === "") return;
  appendPtyBuffer(tabId, text);
  win?.webContents.send("pty:data", { tabId, data: String(text) });
}

function replayPtyBuffer(tabId) {
  if (!tabId || !win || win.isDestroyed()) return;
  const buf = ptyBuffers.get(tabId);
  if (!buf) return;
  win.webContents.send("pty:data", { tabId, data: buf });
}

function disposePtyEntry(entry) {
  if (!entry) return;
  try {
    entry.dataDisposable?.dispose?.();
  } catch {
    // ignore
  }
  try {
    entry.exitDisposable?.dispose?.();
  } catch {
    // ignore
  }
}

function killPty(tabId) {
  const entry = ptys.get(tabId);
  if (!entry) return;
  ptys.delete(tabId);
  disposePtyEntry(entry);
  try {
    entry.process?.kill();
  } catch {
    // already dead
  }
}

function killAllPtys() {
  for (const id of [...ptys.keys()]) {
    killPty(id);
  }
}

function ensurePty(tabId = activeTabId) {
  if (!tabId) return;
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab) return;
  if (ptys.get(tabId)?.process) return;

  const spec = getAgent(tab.agentId);
  const agentPath = resolveAgentPath(tab.agentId);
  const cols = 100;
  const rows = 32;

  const env = {
    ...process.env,
    PATH: getEnvPath(),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    FORCE_COLOR: "1",
  };

  // Drop ELECTRON_* so the nested agent CLI doesn't inherit Cursor's node mode.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;

  let spawned;
  try {
    if (spec.custom) {
      // Arbitrary user command (may include args) via login shell for PATH.
      spawned = pty.spawn("/bin/zsh", ["-lc", spec.command], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: workspace,
        env,
      });
    } else {
      spawned = pty.spawn(agentPath, [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: workspace,
        env,
      });
    }
  } catch (err) {
    sendPtyData(
      tabId,
      `\r\n\x1b[31mFailed to start ${spec.label}:\x1b[0m ${err.message}\r\n` +
        `Looked for: ${spec.custom ? spec.command : agentPath}\r\n` +
        `${spec.installHint || "Check the command and click Restart."}\r\n`,
    );
    return;
  }

  const entry = {
    process: spawned,
    dataDisposable: null,
    exitDisposable: null,
  };
  ptys.set(tabId, entry);

  entry.dataDisposable = spawned.onData((data) => {
    if (ptys.get(tabId)?.process !== spawned) return;
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    sendPtyData(tabId, text);
  });

  entry.exitDisposable = spawned.onExit(({ exitCode }) => {
    if (ptys.get(tabId)?.process !== spawned) return;
    ptys.delete(tabId);
    disposePtyEntry(entry);
    sendPtyData(
      tabId,
      `\r\n\x1b[90m${spec.command} exited (${exitCode ?? "?"}). Click Restart or expand again.\x1b[0m\r\n`,
    );
    sendState();
  });

  sendState();
}

function writePty(data, tabId = activeTabId) {
  if (!tabId) return;
  if (!ptys.get(tabId)?.process) ensurePty(tabId);
  try {
    ptys.get(tabId)?.process?.write(data);
  } catch {
    // ignore
  }
}

function resizePty(cols, rows, tabId = activeTabId) {
  const proc = tabId ? ptys.get(tabId)?.process : null;
  if (!proc) return;
  try {
    proc.resize(Math.max(20, cols), Math.max(5, rows));
  } catch {
    // ignore
  }
}

function restartPty(tabId = activeTabId) {
  if (!tabId) return;
  killPty(tabId);
  clearPtyBuffer(tabId);
  if (win && !win.isDestroyed()) {
    win.webContents.send("pty:reset", { tabId });
  }
  if (expanded) ensurePty(tabId);
}

function rebuildTrayMenu() {
  if (!tray) return;
  const openAtLogin = isOpenAtLoginEnabled();
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
        label: "Always on Top",
        type: "checkbox",
        checked: alwaysOnTop,
        click: (item) => setAlwaysOnTopEnabled(item.checked),
      },
      {
        label: "Open at Login",
        type: "checkbox",
        checked: openAtLogin,
        click: (item) => setOpenAtLoginEnabled(item.checked),
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
}

function createTray() {
  if (tray) return;
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAPUlEQVQ4T2NkYGD4z0ABYBzVMKoBBgYGBob/UAaTAcXG/xkwACaGmYGBgYERrysYKTUAph/FYRQD0DYAALq/AxG1QvK0AAAAAElFTkSuQmCC";
  const image = nativeImage.createFromDataURL(`data:image/png;base64,${pngBase64}`);
  image.setTemplateImage(true);

  tray = new Tray(image);
  tray.setToolTip("Agent Widget");
  rebuildTrayMenu();

  tray.on("click", () => {
    if (!win) createWindow();
    setExpanded(!expanded);
    win?.show();
  });
}

function registerIpc() {
  ipcMain.on("widget:expand", () => setExpanded(true));
  ipcMain.on("widget:collapse", () => {
    requestCollapse();
  });
  ipcMain.on("widget:toggle", () => setExpanded(!expanded));
  ipcMain.on("widget:restart", () => restartPty());
  ipcMain.on("widget:quit", () => {
    app.isQuitting = true;
    app.quit();
  });
  ipcMain.on("widget:pill-menu", () => {
    if (!win || win.isDestroyed()) return;
    const menu = Menu.buildFromTemplate([
      {
        label: "Open Agent",
        click: () => {
          setExpanded(true);
          win.show();
          win.focus();
        },
      },
      {
        label: alwaysOnTop ? "Disable Always on Top" : "Enable Always on Top",
        click: () => setAlwaysOnTopEnabled(!alwaysOnTop),
      },
      { type: "separator" },
      {
        label: "New Tab",
        click: () => createTab(),
      },
      {
        label: "Close All Tabs",
        click: () => closeAllTabs(),
      },
      { type: "separator" },
      {
        label: "Quit Agent Widget",
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]);
    menu.popup({ window: win });
  });
  ipcMain.on("widget:set-always-on-top", (_e, value) => setAlwaysOnTopEnabled(value));
  ipcMain.handle("widget:set-open-at-login", (_e, value) => setOpenAtLoginEnabled(value));
  ipcMain.on("widget:set-ignore-mouse", (_e, ignore) => {
    if (!win || win.isDestroyed() || expanded) return;
    if (!alwaysOnTop) {
      // No click-through mode when not always-on-top.
      armPillHits();
      return;
    }
    if (ignore) {
      win.setIgnoreMouseEvents(true, { forward: true });
    } else {
      armPillHits();
    }
  });
  ipcMain.on("widget:move-by", (_e, { dx, dy }) => {
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    setWindowPositionClamped(x + Number(dx) || 0, y + Number(dy) || 0);
    if (!expanded) {
      rememberPillScreen(readCollapsedPillScreen());
    }
  });
  ipcMain.on("widget:set-agent", (_e, nextId) => setAgentId(String(nextId || "")));
  ipcMain.handle("widget:add-agent", (_e, payload) => addCustomAgent(payload || {}));
  ipcMain.handle("widget:remove-agent", (_e, id) => removeCustomAgent(String(id || "")));
  ipcMain.handle("widget:new-tab", (_e, agentIdArg) =>
    createTab(agentIdArg ? String(agentIdArg) : undefined),
  );
  ipcMain.handle("widget:set-tab", (_e, id) => setActiveTab(String(id || "")));
  ipcMain.handle("widget:close-tab", (_e, id) => closeTab(String(id || "")));
  ipcMain.handle("widget:close-all-tabs", () => closeAllTabs());
  ipcMain.handle("widget:replay-tab", (_e, id) => {
    const tabId = String(id || activeTabId || "");
    if (!tabId) return { ok: false };
    ensurePty(tabId);
    replayPtyBuffer(tabId);
    return { ok: true };
  });
  ipcMain.handle("widget:get-state", () => {
    syncAgentIdFromActiveTab();
    const spec = currentAgent();
    const activePty = activeTabId ? ptys.get(activeTabId) : null;
    return {
      expanded,
      alwaysOnTop,
      openAtLogin: isOpenAtLoginEnabled(),
      workspace,
      agentId,
      agentLabel: spec.label,
      agentCommand: spec.command,
      agentCustom: Boolean(spec.custom),
      agentPath: resolveAgentPath(agentId),
      agents: listAgents(),
      tabs: listTabs(),
      activeTabId,
      running: Boolean(activePty?.process),
    };
  });
  ipcMain.on("pty:input", (_e, payload) => {
    if (payload && typeof payload === "object" && "data" in payload) {
      writePty(payload.data, payload.tabId || activeTabId);
    } else {
      writePty(payload);
    }
  });
  ipcMain.on("pty:resize", (_e, { cols, rows, tabId }) =>
    resizePty(cols, rows, tabId || activeTabId),
  );
  ipcMain.handle("widget:pick-workspace", async () => {
    const { dialog } = require("electron");
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory", "createDirectory"],
      defaultPath: workspace,
    });
    if (!result.canceled && result.filePaths[0]) {
      workspace = result.filePaths[0];
      saveConfig();
      for (const tab of tabs) {
        restartPty(tab.id);
      }
      sendState();
    }
    return workspace;
  });
}

if (gotLock) {
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
    saveBuffersNow();
  });

  app.on("will-quit", () => {
    saveBuffersNow();
    globalShortcut.unregisterAll();
    killAllPtys();
  });

  app.on("window-all-closed", () => {
    // Stay alive in the menu bar tray.
  });
}
