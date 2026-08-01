const app = document.getElementById("app");
const pill = document.getElementById("pill");
const panel = document.getElementById("panel");
const termHost = document.getElementById("terminal");
const workspaceLabel = document.getElementById("workspace-label");
const btnPin = document.getElementById("btn-pin");
const btnCollapse = document.getElementById("btn-collapse");
const btnRestart = document.getElementById("btn-restart");
const btnWorkspace = document.getElementById("btn-workspace");
const pillSub = document.querySelector(".pill-sub");

let term = null;
let fitAddon = null;
let leaveTimer = null;
let pinned = false;
let expanded = false;

function shortenHome(p) {
  if (!p) return "~/";
  return p.replace(/^\/Users\/[^/]+/, "~");
}

function setMode(nextExpanded) {
  expanded = nextExpanded;
  app.dataset.mode = nextExpanded ? "expanded" : "collapsed";
  panel.setAttribute("aria-hidden", nextExpanded ? "false" : "true");
  if (nextExpanded) {
    requestAnimationFrame(() => {
      fitTerminal();
      term?.focus();
    });
  }
}

function fitTerminal() {
  if (!fitAddon || !term || !expanded) return;
  try {
    fitAddon.fit();
    window.widget.resize(term.cols, term.rows);
  } catch {
    // terminal not ready
  }
}

function ensureTerminal() {
  if (term) return;

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

  term.onData((data) => window.widget.write(data));

  window.widget.onData((data) => term.write(data));
  window.widget.onClear(() => term.clear());

  const ro = new ResizeObserver(() => fitTerminal());
  ro.observe(termHost);
}

function applyState(state) {
  pinned = Boolean(state.pinned);
  btnPin.setAttribute("aria-pressed", pinned ? "true" : "false");
  btnPin.textContent = pinned ? "Pinned" : "Pin";
  workspaceLabel.textContent = shortenHome(state.workspace);
  pillSub.textContent = state.running ? "live" : "ready";
  setMode(Boolean(state.expanded));
  if (state.expanded) ensureTerminal();
}

function expand() {
  clearTimeout(leaveTimer);
  ensureTerminal();
  window.widget.expand();
}

function scheduleCollapse() {
  if (pinned) return;
  clearTimeout(leaveTimer);
  leaveTimer = setTimeout(() => {
    // Don't auto-collapse while the terminal still has keyboard focus.
    if (pinned) return;
    if (document.activeElement && termHost.contains(document.activeElement)) return;
    if (term?.textarea && document.activeElement === term.textarea) return;
    window.widget.collapse();
  }, 420);
}

pill.addEventListener("mouseenter", expand);
pill.addEventListener("focus", expand);
pill.addEventListener("click", expand);

panel.addEventListener("mouseenter", () => clearTimeout(leaveTimer));
panel.addEventListener("mouseleave", scheduleCollapse);

btnCollapse.addEventListener("click", () => {
  if (pinned) window.widget.pin(false);
  window.widget.collapse();
});

btnPin.addEventListener("click", () => {
  window.widget.pin(!pinned);
});

btnRestart.addEventListener("click", () => {
  ensureTerminal();
  term?.clear();
  window.widget.restart();
  term?.focus();
});

btnWorkspace.addEventListener("click", async () => {
  await window.widget.pickWorkspace();
  term?.focus();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && expanded && !pinned) {
    window.widget.collapse();
  }
});

window.addEventListener("resize", () => fitTerminal());

window.widget.onState(applyState);
window.widget.getState().then(applyState);
