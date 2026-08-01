#!/usr/bin/env node
/**
 * Colorized CLI install wizard for Agent Widget (macOS).
 *
 *   ./install              # pick Auto or Custom
 *   ./install --auto       # no questions (defaults)
 *   ./install --custom     # ask every preference
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");
const { spawn, spawnSync, execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(os.homedir(), ".cursor-agent-widget.json");

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[38;2;183;243;92m",
  mint: "\x1b[38;2;92;224;178m",
  text: "\x1b[38;2;231;242;234m",
  muted: "\x1b[38;2;142;163;152m",
  err: "\x1b[38;2;255;122;102m",
};

function paint(code, s) {
  return useColor ? `${code}${s}${c.reset}` : String(s);
}
const bold = (s) => paint(c.bold, s);
const dim = (s) => paint(c.dim, s);
const green = (s) => paint(c.green, s);
const mint = (s) => paint(c.mint, s);
const muted = (s) => paint(c.muted, s);
const err = (s) => paint(c.err, s);
const text = (s) => paint(c.text, s);

function hr() {
  console.log(muted("  " + "─".repeat(52)));
}

function banner(modeLabel) {
  console.log();
  console.log(green("  ╭────────────────────────────────────────────────────╮"));
  console.log(
    green("  │") +
      bold(text("  Agent Widget")) +
      muted("  ·  floating agent terminal  ") +
      green("│"),
  );
  console.log(green("  ╰────────────────────────────────────────────────────╯"));
  console.log(dim(`  install wizard · ${modeLabel}`));
  console.log();
}

function step(n, total, title) {
  console.log();
  console.log(
    mint("  ◆") + bold(text(`  Step ${n}/${total}`)) + muted("  ·  ") + text(title),
  );
  hr();
}

function ok(msg) {
  console.log(green("  ✓  ") + text(msg));
}
function fail(msg) {
  console.log(err("  ✗  ") + text(msg));
}
function info(msg) {
  console.log(mint("  →  ") + muted(msg));
}
function note(msg) {
  console.log(dim("     " + msg));
}

function createRl() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, question, { defaultValue = "", yesNo = false } = {}) {
  const defLabel =
    defaultValue === ""
      ? ""
      : yesNo
        ? defaultValue
          ? "Y/n"
          : "y/N"
        : String(defaultValue);
  const suffix = defLabel ? muted(` (${defLabel})`) : "";
  const prompt = mint("  ?  ") + text(question) + suffix + muted("  › ");

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      const raw = String(answer ?? "").trim();
      if (yesNo) {
        resolve(raw ? /^(y|yes)$/i.test(raw) : Boolean(defaultValue));
        return;
      }
      resolve(raw || defaultValue);
    });
  });
}

function choice(rl, question, options, defaultIndex = 0) {
  console.log(mint("  ?  ") + text(question));
  options.forEach((opt, i) => {
    const mark = i === defaultIndex ? green("●") : muted("○");
    console.log(`     ${mark}  ${muted(`[${i + 1}]`)}  ${text(opt.label)}`);
    if (opt.hint) note(opt.hint);
  });
  return ask(rl, "Choose number", { defaultValue: String(defaultIndex + 1) }).then(
    (raw) => {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n >= 1 && n <= options.length) return options[n - 1];
      return options[defaultIndex];
    },
  );
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "",
      ELECTRON_NO_ATTACH_CONSOLE: "",
    },
  });
  return res.status === 0;
}

function which(bin) {
  try {
    return execSync(`command -v ${bin}`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function expandHome(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

function readExistingConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeConfig({ workspace, agentId, alwaysOnTop }) {
  const existing = readExistingConfig();
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify({ ...existing, workspace, agentId, alwaysOnTop }, null, 2) + "\n",
    "utf8",
  );
}

function parseMode(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) return "help";
  if (args.includes("--auto") || args.includes("-y") || args.includes("--yes")) {
    return "auto";
  }
  if (args.includes("--custom") || args.includes("-i") || args.includes("--interactive")) {
    return "custom";
  }
  return null;
}

function printHelp() {
  console.log(`
Usage: ./install [mode]

  --auto, -y       Auto mode — defaults, no questions
  --custom, -i     Custom mode — ask every preference
  (no flag)        Ask which mode to use

Auto defaults:
  · npm install if needed
  · workspace from config or home
  · agent Cursor (or Claude if only Claude is on PATH)
  · always on top on
  · open at login on
  · launch when finished
`);
}

function launchWidget() {
  info("Launching…");
  const launch = path.join(ROOT, "scripts", "launch.sh");
  fs.chmodSync(launch, 0o755);
  const child = spawn(launch, [], {
    cwd: ROOT,
    stdio: "ignore",
    detached: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "",
      ELECTRON_NO_ATTACH_CONSOLE: "",
    },
  });
  child.unref();
}

function finishBanner() {
  console.log();
  hr();
  console.log(green("  ✓  ") + bold(text("Install complete")));
  console.log();
  console.log(muted("  Open later"));
  note('open -a "Agent Widget"');
  note(`npm start   ${dim("(from repo)")}`);
  console.log();
  console.log(muted("  While running"));
  note("⌘⇧A  toggle widget");
  note("Click the pill to expand · drag to move · ✕ to quit");
  console.log();
  hr();
  console.log();
}

async function pickMode(rl) {
  if (!process.stdin.isTTY) return "auto";
  const picked = await choice(
    rl,
    "Install mode",
    [
      {
        id: "auto",
        label: "Auto",
        hint: "Recommended defaults — no further questions",
      },
      {
        id: "custom",
        label: "Custom",
        hint: "Ask workspace, agent, login, launch, …",
      },
    ],
    0,
  );
  return picked.id;
}

async function wizard() {
  const flagged = parseMode(process.argv);
  if (flagged === "help") {
    printHelp();
    return;
  }

  if (process.platform !== "darwin") {
    banner("error");
    fail("This app is macOS-only.");
    process.exit(1);
  }

  const total = 5;
  const rl = flagged ? null : createRl();
  let mode = flagged;

  try {
    if (!mode) {
      banner("choose mode");
      mode = await pickMode(rl);
      console.log();
      ok(`Mode → ${mode}`);
    }

    banner(mode === "auto" ? "auto mode" : "custom mode");
    const interactive = mode === "custom";
    const promptRl = interactive ? rl || createRl() : null;

    step(1, total, "Environment");
    const nodeVer = process.versions.node;
    if (Number(nodeVer.split(".")[0]) < 18) {
      fail(`Node.js ${nodeVer} found — need 18+`);
      process.exit(1);
    }
    ok(`Node.js v${nodeVer}`);
    ok(`npm  ${execSync("npm -v", { encoding: "utf8" }).trim()}`);

    const hasAgent = Boolean(which("agent") || which("cursor-agent"));
    const hasClaude = Boolean(which("claude"));
    if (hasAgent) ok("Cursor agent CLI found on PATH");
    if (hasClaude) ok("Claude CLI found on PATH");
    if (!hasAgent && !hasClaude) {
      info("No agent / claude on PATH yet — install later, then Restart in the widget.");
    }

    step(2, total, "Install packages");
    const modulesOk = fs.existsSync(path.join(ROOT, "node_modules", "electron"));
    let doNpm = !modulesOk;
    if (modulesOk) {
      ok("node_modules already present");
      if (interactive) {
        doNpm = await ask(promptRl, "Reinstall dependencies?", {
          defaultValue: false,
          yesNo: true,
        });
      } else {
        info("Auto: keeping existing node_modules");
      }
    } else {
      info("Installing npm dependencies (electron, node-pty, xterm)…");
    }
    if (doNpm) {
      console.log();
      if (!run("npm", ["install"])) {
        fail("npm install failed");
        process.exit(1);
      }
      ok("Dependencies installed");
    } else {
      ok("Skipped npm install");
    }

    step(3, total, "Preferences");
    const existing = readExistingConfig();
    const defaultWorkspace = existing.workspace || os.homedir();
    const defaultAgentIndex = hasClaude && !hasAgent ? 1 : 0;

    let workspace;
    let agent;
    let alwaysOnTop;
    let openAtLogin;

    if (interactive) {
      workspace = expandHome(
        await ask(promptRl, "Default workspace folder", {
          defaultValue: defaultWorkspace,
        }),
      );
      if (!fs.existsSync(workspace)) {
        const create = await ask(promptRl, "Folder missing. Create it?", {
          defaultValue: true,
          yesNo: true,
        });
        if (!create) {
          fail("Workspace required");
          process.exit(1);
        }
        fs.mkdirSync(workspace, { recursive: true });
      }

      agent = await choice(
        promptRl,
        "Default agent",
        [
          { id: "cursor", label: "Cursor  (agent)" },
          { id: "claude", label: "Claude  (claude)" },
        ],
        defaultAgentIndex,
      );

      alwaysOnTop = await ask(promptRl, "Start always on top?", {
        defaultValue: existing.alwaysOnTop !== false,
        yesNo: true,
      });
      openAtLogin = await ask(promptRl, "Open Agent Widget at login?", {
        defaultValue: true,
        yesNo: true,
      });
    } else {
      workspace = expandHome(defaultWorkspace);
      if (!fs.existsSync(workspace)) {
        fs.mkdirSync(workspace, { recursive: true });
        info(`Created workspace ${workspace.replace(os.homedir(), "~")}`);
      }
      agent =
        defaultAgentIndex === 1
          ? { id: "claude", label: "Claude  (claude)" }
          : { id: "cursor", label: "Cursor  (agent)" };
      alwaysOnTop = existing.alwaysOnTop !== false;
      openAtLogin = true;
      info("Auto defaults applied");
    }

    ok(`Workspace → ${workspace.replace(os.homedir(), "~")}`);
    ok(`Agent → ${agent.label}`);
    ok(`Always on top → ${alwaysOnTop ? "yes" : "no"}`);
    ok(`Open at login → ${openAtLogin ? "yes" : "no"}`);

    step(4, total, "Apply");
    writeConfig({ workspace, agentId: agent.id, alwaysOnTop });
    ok(`Config → ${CONFIG_PATH.replace(os.homedir(), "~")}`);

    const startup = require("./startup-lib.cjs");
    info("Creating ~/Applications/Agent Widget.app …");
    startup.install({ openAtLogin });
    if (openAtLogin) {
      ok("Open at login enabled (starts on next login)");
    } else {
      ok("App shortcut installed (login left off)");
    }
    ok(`App → ~/Applications/${startup.APP_NAME}.app`);

    step(5, total, "Finish");
    let launchNow = true;
    if (interactive) {
      launchNow = await ask(promptRl, "Launch Agent Widget now?", {
        defaultValue: true,
        yesNo: true,
      });
    } else {
      info("Auto: launching Agent Widget");
    }

    finishBanner();

    if (rl) rl.close();
    if (promptRl && promptRl !== rl) promptRl.close();

    if (launchNow) launchWidget();
  } catch (e) {
    try {
      rl?.close();
    } catch {
      // ignore
    }
    fail(String(e?.message || e));
    process.exit(1);
  }
}

wizard();
