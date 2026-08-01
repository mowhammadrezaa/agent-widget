#!/usr/bin/env node
/**
 * Colorized CLI uninstall wizard for Agent Widget (macOS).
 *
 *   ./uninstall              # pick Auto or Custom
 *   ./uninstall --auto       # no questions (safe defaults)
 *   ./uninstall --custom     # ask every removal option
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");
const { execSync, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(os.homedir(), ".cursor-agent-widget.json");
const LOG_OUT = path.join(os.homedir(), "Library", "Logs", "agent-widget.log");
const LOG_ERR = path.join(os.homedir(), "Library", "Logs", "agent-widget.err.log");

const startup = require("./startup-lib.cjs");

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[38;2;183;243;92m",
  mint: "\x1b[38;2;92;224;178m",
  text: "\x1b[38;2;231;242;234m",
  muted: "\x1b[38;2;142;163;152m",
  warn: "\x1b[38;2;255;196;110m",
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
const warn = (s) => paint(c.warn, s);
const err = (s) => paint(c.err, s);
const text = (s) => paint(c.text, s);

function hr() {
  console.log(muted("  " + "─".repeat(52)));
}

function banner(modeLabel) {
  console.log();
  console.log(err("  ╭────────────────────────────────────────────────────╮"));
  console.log(
    err("  │") +
      bold(text("  Agent Widget")) +
      muted("  ·  uninstall wizard           ") +
      err("│"),
  );
  console.log(err("  ╰────────────────────────────────────────────────────╯"));
  console.log(dim(`  uninstall wizard · ${modeLabel}`));
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
function skip(msg) {
  console.log(dim("  –  " + msg));
}
function note(msg) {
  console.log(dim("     " + msg));
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function shortHome(p) {
  return String(p).replace(os.homedir(), "~");
}

function createRl() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, question, { defaultValue = false, yesNo = true } = {}) {
  const defLabel = yesNo ? (defaultValue ? "Y/n" : "y/N") : String(defaultValue);
  const prompt = mint("  ?  ") + text(question) + muted(` (${defLabel})`) + muted("  › ");
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
  return ask(rl, "Choose number", {
    defaultValue: String(defaultIndex + 1),
    yesNo: false,
  }).then((raw) => {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1 && n <= options.length) return options[n - 1];
    return options[defaultIndex];
  });
}

function isWidgetRunning() {
  try {
    const out = execSync(
      'pgrep -fl "Agent Widget|cursor-agent-widget|electron.*cursor-widget" 2>/dev/null || true',
      { encoding: "utf8" },
    );
    return Boolean(out.trim());
  } catch {
    return false;
  }
}

function quitWidget() {
  try {
    execSync('pkill -f "cursor-widget/node_modules/electron" 2>/dev/null || true', {
      stdio: "ignore",
    });
  } catch {
    // ignore
  }
  try {
    execSync('pkill -f "Agent Widget" 2>/dev/null || true', { stdio: "ignore" });
  } catch {
    // ignore
  }
  spawnSync("sleep", ["0.4"]);
}

function rm(target, { recursive = false } = {}) {
  try {
    fs.rmSync(target, { recursive, force: true });
    return true;
  } catch {
    return false;
  }
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
Usage: ./uninstall [mode]

  --auto, -y       Auto mode — remove app, login, config, logs (keep node_modules)
  --custom, -i     Custom mode — ask every removal option
  (no flag)        Ask which mode to use

The git repo is never deleted.
`);
}

async function pickMode(rl) {
  if (!process.stdin.isTTY) return "auto";
  const picked = await choice(
    rl,
    "Uninstall mode",
    [
      {
        id: "auto",
        label: "Auto",
        hint: "Remove app, login, config, logs — keep node_modules",
      },
      {
        id: "custom",
        label: "Custom",
        hint: "Choose what to remove",
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

  const total = 4;
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

    step(1, total, "Detect");
    const hasApp = exists(startup.APP_DIR);
    const hasLogin = startup.isOpenAtLogin();
    const hasConfig = exists(CONFIG_PATH);
    const hasModules = exists(path.join(ROOT, "node_modules"));
    const hasLogs = exists(LOG_OUT) || exists(LOG_ERR);
    const running = isWidgetRunning();

    if (hasApp) ok(`App  ${shortHome(startup.APP_DIR)}`);
    else skip("App bundle not found");
    if (hasLogin) ok(`Login item  ${shortHome(startup.PLIST)}`);
    else skip("Login item not found");
    if (hasConfig) ok(`Config  ${shortHome(CONFIG_PATH)}`);
    else skip("Config not found");
    if (hasModules) ok(`node_modules  ${shortHome(path.join(ROOT, "node_modules"))}`);
    else skip("node_modules not found");
    if (hasLogs) ok("Launch logs in ~/Library/Logs");
    if (running) info(warn("Agent Widget appears to be running"));

    if (!hasApp && !hasLogin && !hasConfig && !hasModules && !hasLogs && !running) {
      console.log();
      ok("Nothing to uninstall");
      rl?.close();
      promptRl?.close();
      return;
    }

    step(2, total, "Confirm");
    console.log(warn("  This will remove selected Agent Widget integrations."));
    console.log(dim("  The git repo itself is never deleted."));
    console.log();

    let proceed = true;
    let quitFirst = running;
    let removeApp = true;
    let removeConfig = true;
    let removeLogs = true;
    let removeModules = false;

    if (interactive) {
      proceed = await ask(promptRl, "Continue with uninstall?", { defaultValue: true });
      if (!proceed) {
        info("Cancelled — nothing changed");
        rl?.close();
        if (promptRl && promptRl !== rl) promptRl.close();
        return;
      }
      quitFirst =
        running &&
        (await ask(promptRl, "Quit the running widget first?", { defaultValue: true }));
      removeApp = await ask(promptRl, "Remove app + login item?", { defaultValue: true });
      removeConfig = await ask(promptRl, "Remove config ~/.cursor-agent-widget.json?", {
        defaultValue: true,
      });
      removeLogs = await ask(promptRl, "Remove launch logs?", { defaultValue: true });
      removeModules = await ask(promptRl, "Remove repo node_modules?", {
        defaultValue: false,
      });
    } else {
      info("Auto: quit widget (if running), remove app/login/config/logs");
      info("Auto: keeping node_modules");
    }

    step(3, total, "Remove");
    if (quitFirst) {
      quitWidget();
      ok("Asked widget process to quit");
    } else if (running) {
      skip("Left widget running");
    }

    if (removeApp) {
      startup.uninstallAll();
      ok("Removed login item");
      ok(`Removed ${shortHome(startup.APP_DIR)}`);
    } else {
      skip("Kept app + login item");
    }

    if (removeConfig) {
      if (rm(CONFIG_PATH)) ok(`Removed ${shortHome(CONFIG_PATH)}`);
      else skip("Config already gone");
    } else {
      skip("Kept config");
    }

    if (removeLogs) {
      const a = rm(LOG_OUT);
      const b = rm(LOG_ERR);
      if (a || b) ok("Removed launch logs");
      else skip("No launch logs");
    } else {
      skip("Kept launch logs");
    }

    if (removeModules) {
      const mod = path.join(ROOT, "node_modules");
      info("Removing node_modules…");
      if (rm(mod, { recursive: true })) ok("Removed node_modules");
      else fail("Could not remove node_modules");
    } else {
      skip("Kept node_modules");
    }

    step(4, total, "Done");
    console.log();
    hr();
    console.log(green("  ✓  ") + bold(text("Uninstall complete")));
    console.log();
    console.log(muted("  Optional cleanup"));
    note(`rm -rf ${shortHome(ROOT)}   ${dim("(delete the repo)")}`);
    console.log();
    console.log(muted("  Reinstall later"));
    note("./install --auto");
    note("./install --custom");
    console.log();
    hr();
    console.log();

    rl?.close();
    if (promptRl && promptRl !== rl) promptRl.close();
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
