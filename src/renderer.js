const app = document.getElementById("app");
const pill = document.getElementById("pill");
const pillQuit = document.getElementById("pill-quit");
const panel = document.getElementById("panel");
const termHost = document.getElementById("terminal");
const tabList = document.getElementById("tab-list");
const btnNewTab = document.getElementById("btn-new-tab");
const btnCloseAllTabs = document.getElementById("btn-close-all-tabs");
const workspaceLabel = document.getElementById("workspace-label");
const brandTitle = document.getElementById("brand-title");
const agentSelect = document.getElementById("agent-select");
const agentAdd = document.getElementById("agent-add");
const agentCommandInput = document.getElementById("agent-command-input");
const agentLabelInput = document.getElementById("agent-label-input");
const btnAddAgent = document.getElementById("btn-add-agent");
const btnRemoveAgent = document.getElementById("btn-remove-agent");
const btnAgentSave = document.getElementById("btn-agent-save");
const btnAgentCancel = document.getElementById("btn-agent-cancel");
const hintCommand = document.getElementById("hint-command");
const pillTitle = document.querySelector(".pill-title");
const btnTop = document.getElementById("btn-top");
const btnLogin = document.getElementById("btn-login");
const btnCollapse = document.getElementById("btn-collapse");
const btnQuit = document.getElementById("btn-quit");
const btnRestart = document.getElementById("btn-restart");
const btnWorkspace = document.getElementById("btn-workspace");
const pillSub = document.querySelector(".pill-sub");

/** @type {Map<string, string>} scrollback retained in main, replayed on tab switch */
// (renderer keeps one live xterm — multi-pane broke input/echo)

let term = null;
let fitAddon = null;
let resizeObserver = null;
let leaveTimer = null;
let alwaysOnTop = true;
let openAtLogin = false;
let expanded = false;
let ignoreMouse = true;
let booted = false;
let activeTabId = null;
let ptyWired = false;

function markBooted() {
  if (booted) return;
  booted = true;
  pill.removeAttribute("data-boot");
  pill.removeAttribute("aria-busy");
}

function shortenHome(p) {
  if (!p) return "~/";
  return p.replace(/^\/Users\/[^/]+/, "~");
}

function setMode(nextExpanded) {
  expanded = nextExpanded;
  app.dataset.mode = nextExpanded ? "expanded" : "collapsed";
  panel.setAttribute("aria-hidden", nextExpanded ? "false" : "true");

  if (nextExpanded) {
    ignoreMouse = false;
    window.widget.setIgnoreMouse(false);
    requestAnimationFrame(() => {
      fitTerminal();
      term?.focus();
    });
  } else {
    ignoreMouse = true;
    // Click-through empty glass; pill re-enables hit-testing on hover.
    window.widget.setIgnoreMouse(true);
  }
}

function fitTerminal() {
  if (!fitAddon || !term || !expanded) return;
  try {
    fitAddon.fit();
    window.widget.resize(term.cols, term.rows, activeTabId || undefined);
  } catch {
    // terminal not ready
  }
}

function destroyTerminal() {
  try {
    resizeObserver?.disconnect();
  } catch {
    // ignore
  }
  resizeObserver = null;

  try {
    term?.dispose();
  } catch {
    // ignore
  }
  term = null;
  fitAddon = null;
  termHost.replaceChildren();
}

function createTerminal() {
  destroyTerminal();

  const { Terminal } = window;
  const FitAddon = window.FitAddon.FitAddon;
  const WebLinksAddon = window.WebLinksAddon.WebLinksAddon;

  term = new Terminal({
    convertEol: true,
    cursorBlink: true,
    fontFamily: '"IBM Plex Mono", "SF Mono", Menlo, monospace',
    fontSize: 13,
    lineHeight: 1.35,
    theme: {
      background: "#00000000",
      foreground: "#e7f2ea",
      cursor: "#b7f35c",
      cursorAccent: "#0c1210",
      selectionBackground: "rgba(183, 243, 92, 0.28)",
      black: "#0c1210",
      red: "#ff7a66",
      green: "#b7f35c",
      yellow: "#e7d37a",
      blue: "#7eb6ff",
      magenta: "#d7a6ff",
      cyan: "#5ce0b2",
      white: "#e7f2ea",
      brightBlack: "#5d7166",
      brightRed: "#ff9a8b",
      brightGreen: "#d2ff8f",
      brightYellow: "#ffe59a",
      brightBlue: "#a8ceff",
      brightMagenta: "#e6c4ff",
      brightCyan: "#8ff0d0",
      brightWhite: "#ffffff",
    },
    allowProposedApi: true,
  });

  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  term.open(termHost);

  // Always write to whatever tab is active now (not a stale closure).
  term.onData((data) => window.widget.write(data, activeTabId || undefined));

  if (!resizeObserver) {
    resizeObserver = new ResizeObserver(() => fitTerminal());
    resizeObserver.observe(termHost);
  } else {
    resizeObserver.observe(termHost);
  }
}

function ensureTerminal() {
  if (term) return;
  createTerminal();
}

function wirePtyBridge() {
  if (ptyWired) return;
  ptyWired = true;

  window.widget.onData((payload) => {
    const tabId = payload?.tabId;
    const data =
      typeof payload === "string"
        ? payload
        : typeof payload?.data === "string"
          ? payload.data
          : "";
    if (!data) return;
    // Only paint output for the active tab (inactive tabs buffer in main).
    if (tabId && activeTabId && tabId !== activeTabId) return;
    if (!term) return;
    term.write(data);
  });

  window.widget.onReset((payload) => {
    if (payload?.tabId && activeTabId && payload.tabId !== activeTabId && !payload?.all) {
      return;
    }
    const wasFocused = expanded;
    createTerminal();
    if (wasFocused) {
      fitTerminal();
      term?.focus();
      if (activeTabId) window.widget.replayTab(activeTabId);
    }
  });
}

function renderTabs(tabs, selectedId) {
  if (!tabList) return;
  tabList.replaceChildren();
  for (const tab of tabs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab";
    btn.setAttribute("role", "tab");
    btn.dataset.tabId = tab.id;
    btn.setAttribute("aria-selected", tab.id === selectedId ? "true" : "false");
    btn.title = tab.title;

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title;

    const close = document.createElement("span");
    close.className = "tab-close";
    close.setAttribute("role", "button");
    close.setAttribute("aria-label", `Close ${tab.title}`);
    close.textContent = "×";
    close.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      holdCollapse();
      window.widget.closeTab(tab.id);
      releaseCollapseSoon(400);
    });

    btn.append(title, close);
    btn.addEventListener("click", (e) => {
      if (e.target === close || close.contains(e.target)) return;
      holdCollapse();
      window.widget.setTab(tab.id);
      releaseCollapseSoon(400);
    });
    tabList.appendChild(btn);
  }
}

function applyState(state) {
  alwaysOnTop = state.alwaysOnTop !== false;
  openAtLogin = Boolean(state.openAtLogin);
  btnTop.setAttribute("aria-pressed", alwaysOnTop ? "true" : "false");
  btnTop.dataset.tip = alwaysOnTop ? "Disable always on top" : "Keep above other windows";
  btnLogin.setAttribute("aria-pressed", openAtLogin ? "true" : "false");
  btnLogin.dataset.tip = openAtLogin ? "Disable open at login" : "Open at login";
  workspaceLabel.textContent = shortenHome(state.workspace);

  const label = state.agentLabel || "Cursor";
  const command = state.agentCommand || "agent";
  brandTitle.textContent = `${label} Agent`;
  if (pillTitle) pillTitle.textContent = label;
  pillSub.textContent = state.running ? "live" : "ready";
  if (hintCommand) hintCommand.textContent = command;

  if (Array.isArray(state.agents) && state.agents.length) {
    const current = agentSelect.value;
    agentSelect.innerHTML = "";
    for (const agent of state.agents) {
      const opt = document.createElement("option");
      opt.value = agent.id;
      const showCommand =
        agent.custom && agent.command && agent.label !== agent.command;
      opt.textContent = showCommand
        ? `${agent.label} (${agent.command})`
        : agent.label;
      opt.title = agent.command;
      agentSelect.appendChild(opt);
    }
    agentSelect.value = state.agentId || current || "cursor";
  } else if (state.agentId) {
    agentSelect.value = state.agentId;
  }

  btnRemoveAgent.hidden = !state.agentCustom;

  const tabs = Array.isArray(state.tabs) && state.tabs.length
    ? state.tabs
    : [{ id: "legacy", agentId: state.agentId || "cursor", title: label }];
  const selected = state.activeTabId || tabs[0].id;
  const tabChanged = activeTabId && selected && activeTabId !== selected;
  activeTabId = selected;
  renderTabs(tabs, selected);

  markBooted();
  setMode(Boolean(state.expanded));

  if (state.expanded) {
    if (!term) {
      ensureTerminal();
      requestAnimationFrame(() => {
        fitTerminal();
        term?.focus();
        if (selected) window.widget.replayTab(selected);
      });
    } else if (tabChanged) {
      // Switching tabs: clear view, then ask main to replay that tab's buffer.
      term.clear();
      term.reset();
      requestAnimationFrame(() => {
        fitTerminal();
        term?.focus();
        window.widget.replayTab(selected);
      });
    } else {
      requestAnimationFrame(() => {
        fitTerminal();
        term?.focus();
      });
    }
  }
}

function expand() {
  clearTimeout(leaveTimer);
  ensureTerminal();
  window.widget.expand();
}

let suppressCollapse = false;
let suppressTimer = null;

function holdCollapse() {
  suppressCollapse = true;
  clearTimeout(suppressTimer);
}

function releaseCollapseSoon(ms = 500) {
  clearTimeout(suppressTimer);
  suppressTimer = setTimeout(() => {
    suppressCollapse = false;
  }, ms);
}

function collapseNow() {
  clearTimeout(leaveTimer);
  if (suppressCollapse || !expanded) return;
  if (!agentAdd.hidden) return;
  const active = document.activeElement;
  if (
    active === agentSelect ||
    active?.closest?.(".actions") ||
    active?.closest?.("#chrome") ||
    active?.closest?.("#tab-bar") ||
    active?.closest?.("#agent-add")
  ) {
    return;
  }
  window.widget.collapse();
}

// Hover only arms hit-testing — never opens. Click opens; drag moves.
pill.addEventListener("mouseenter", () => {
  if (pill.dataset.boot === "1") return;
  if (ignoreMouse) {
    ignoreMouse = false;
    window.widget.setIgnoreMouse(false);
  }
});
pill.addEventListener("mouseleave", (e) => {
  if (expanded || dragging || ignoreMouse) return;
  // Quit sits on the capsule edge; leaving the pill onto its hit-slop
  // must not re-enable click-through mid-click.
  if (e.relatedTarget === pillQuit || pillQuit.contains?.(e.relatedTarget)) return;
  ignoreMouse = true;
  window.widget.setIgnoreMouse(true);
});

let dragging = false;
let dragMoved = false;
let dragLast = null;

pill.addEventListener("pointerdown", (e) => {
  if (expanded || e.button !== 0) return;
  if (pill.dataset.boot === "1") return;
  if (e.target === pillQuit || pillQuit.contains(e.target)) return;
  dragging = true;
  dragMoved = false;
  dragLast = { x: e.screenX, y: e.screenY };
  pill.setPointerCapture(e.pointerId);
  pill.classList.add("dragging");
});

pill.addEventListener("pointermove", (e) => {
  if (!dragging || !dragLast) return;
  const dx = e.screenX - dragLast.x;
  const dy = e.screenY - dragLast.y;
  if (!dragMoved && dx * dx + dy * dy < 9) return;
  dragMoved = true;
  dragLast = { x: e.screenX, y: e.screenY };
  window.widget.moveBy(dx, dy);
});

pill.addEventListener("pointerup", (e) => {
  if (!dragging) return;
  dragging = false;
  pill.classList.remove("dragging");
  try {
    pill.releasePointerCapture(e.pointerId);
  } catch {
    // ignore
  }
  dragLast = null;
  if (!dragMoved) expand();
});

pill.addEventListener("pointercancel", () => {
  dragging = false;
  dragMoved = false;
  dragLast = null;
  pill.classList.remove("dragging");
});

pill.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  window.widget.showPillMenu();
});

function quitFromPill(e) {
  e.preventDefault();
  e.stopPropagation();
  dragging = false;
  dragMoved = false;
  dragLast = null;
  pill.classList.remove("dragging");
  window.widget.quit();
}

// Quit on pointerdown — don't wait for click (preventDefault on down can
 // suppress click), and geometry-based hit arming keeps the whole control live.
pillQuit.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  quitFromPill(e);
});

document.addEventListener("mousemove", (e) => {
  if (expanded || dragging) return;
  const r = pill.getBoundingClientRect();
  const q = pillQuit.getBoundingClientRect();
  // Inflate so quit hit-slop near the capsule edge still arms passthrough.
  const pad = 14;
  const overPill =
    e.clientX >= r.left - pad &&
    e.clientX <= r.right + pad &&
    e.clientY >= r.top - pad &&
    e.clientY <= r.bottom + pad;
  const overQuit =
    e.clientX >= q.left - pad &&
    e.clientX <= q.right + pad &&
    e.clientY >= q.top - pad &&
    e.clientY <= q.bottom + pad;
  const nextIgnore = !(overPill || overQuit);
  if (nextIgnore === ignoreMouse) return;
  ignoreMouse = nextIgnore;
  window.widget.setIgnoreMouse(nextIgnore);
});

panel.addEventListener("mouseleave", (e) => {
  // Opening a native <select> often yields relatedTarget === null.
  if (!e.relatedTarget) return;
  if (panel.contains(e.relatedTarget)) return;
  collapseNow();
});

btnCollapse.addEventListener("click", () => {
  window.widget.collapse();
});

btnQuit.addEventListener("click", () => {
  window.widget.quit();
});

btnTop.addEventListener("click", () => {
  holdCollapse();
  window.widget.setAlwaysOnTop(!alwaysOnTop);
  releaseCollapseSoon(400);
});

btnLogin.addEventListener("click", async () => {
  holdCollapse();
  try {
    openAtLogin = await window.widget.setOpenAtLogin(!openAtLogin);
    btnLogin.setAttribute("aria-pressed", openAtLogin ? "true" : "false");
    btnLogin.dataset.tip = openAtLogin ? "Disable open at login" : "Open at login";
  } catch {
    // main process surfaces errors; keep previous UI until next state push
  }
  releaseCollapseSoon(400);
});

btnRestart.addEventListener("click", () => {
  ensureTerminal();
  window.widget.restart();
});

agentSelect.addEventListener("pointerdown", (e) => {
  e.stopPropagation();
  holdCollapse();
});
agentSelect.addEventListener("mousedown", (e) => {
  e.stopPropagation();
  holdCollapse();
});
agentSelect.addEventListener("click", (e) => {
  e.stopPropagation();
  holdCollapse();
});
agentSelect.addEventListener("focus", () => holdCollapse());
agentSelect.addEventListener("blur", () => releaseCollapseSoon());
agentSelect.addEventListener("change", () => {
  holdCollapse();
  window.widget.setAgent(agentSelect.value);
  releaseCollapseSoon(800);
  term?.focus();
});

function openAgentAdd() {
  holdCollapse();
  agentAdd.hidden = false;
  agentCommandInput.value = "";
  agentLabelInput.value = "";
  agentCommandInput.focus();
}

function closeAgentAdd() {
  agentAdd.hidden = true;
  releaseCollapseSoon(300);
  term?.focus();
}

async function saveAgentAdd() {
  holdCollapse();
  const result = await window.widget.addAgent({
    command: agentCommandInput.value,
    label: agentLabelInput.value,
  });
  if (!result?.ok) {
    agentCommandInput.focus();
    return;
  }
  closeAgentAdd();
}

btnAddAgent.addEventListener("click", (e) => {
  e.stopPropagation();
  openAgentAdd();
});

btnRemoveAgent.addEventListener("click", async (e) => {
  e.stopPropagation();
  holdCollapse();
  await window.widget.removeAgent(agentSelect.value);
  releaseCollapseSoon(500);
  term?.focus();
});

btnNewTab.addEventListener("click", (e) => {
  e.stopPropagation();
  holdCollapse();
  window.widget.newTab(agentSelect.value);
  releaseCollapseSoon(400);
});

btnCloseAllTabs.addEventListener("click", (e) => {
  e.stopPropagation();
  holdCollapse();
  window.widget.closeAllTabs();
  releaseCollapseSoon(400);
});

btnAgentSave.addEventListener("click", (e) => {
  e.stopPropagation();
  saveAgentAdd();
});

btnAgentCancel.addEventListener("click", (e) => {
  e.stopPropagation();
  closeAgentAdd();
});

agentCommandInput.addEventListener("keydown", (e) => {
  holdCollapse();
  if (e.key === "Enter") {
    e.preventDefault();
    saveAgentAdd();
  } else if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeAgentAdd();
  }
});

agentLabelInput.addEventListener("keydown", (e) => {
  holdCollapse();
  if (e.key === "Enter") {
    e.preventDefault();
    saveAgentAdd();
  } else if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeAgentAdd();
  }
});

for (const el of [
  agentAdd,
  agentCommandInput,
  agentLabelInput,
  btnAddAgent,
  btnRemoveAgent,
  btnAgentSave,
  btnAgentCancel,
  btnNewTab,
  btnCloseAllTabs,
  tabList,
]) {
  el?.addEventListener("pointerdown", () => holdCollapse());
  el?.addEventListener("focus", () => holdCollapse(), true);
}

btnWorkspace.addEventListener("click", async () => {
  holdCollapse();
  await window.widget.pickWorkspace();
  releaseCollapseSoon(400);
  term?.focus();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && expanded) {
    if (!agentAdd.hidden) {
      e.preventDefault();
      e.stopPropagation();
      closeAgentAdd();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    window.widget.collapse();
  }
}, true);

window.addEventListener("resize", () => fitTerminal());

wirePtyBridge();
window.widget.onState(applyState);
window.widget.getState().then(applyState);
