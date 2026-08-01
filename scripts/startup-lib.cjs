/**
 * Shared login-item + app-bundle helpers for Agent Widget.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const HOME = os.homedir();
const APP_NAME = "Agent Widget";
const APP_DIR = path.join(HOME, "Applications", `${APP_NAME}.app`);
const LABEL = "com.cursor.agent-widget";
const PLIST = path.join(HOME, "Library", "LaunchAgents", `${LABEL}.plist`);
const LAUNCH = path.join(ROOT, "scripts", "launch.sh");

function ensureLaunchScriptExecutable() {
  fs.chmodSync(LAUNCH, 0o755);
}

function writeAppBundle() {
  const macos = path.join(APP_DIR, "Contents", "MacOS");
  const resources = path.join(APP_DIR, "Contents", "Resources");
  const contents = path.join(APP_DIR, "Contents");
  const iconSrc = path.join(ROOT, "assets", "AppIcon.icns");
  fs.mkdirSync(macos, { recursive: true });
  fs.mkdirSync(resources, { recursive: true });

  const runner = path.join(macos, APP_NAME);
  fs.writeFileSync(
    runner,
    `#!/bin/zsh
set -euo pipefail
exec "${LAUNCH}"
`,
    { mode: 0o755 },
  );
  fs.chmodSync(runner, 0o755);

  if (fs.existsSync(iconSrc)) {
    fs.copyFileSync(iconSrc, path.join(resources, "AppIcon.icns"));
  }

  fs.writeFileSync(
    path.join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>${LABEL}</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleExecutable</key>
  <string>${APP_NAME}</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
`,
  );

  try {
    execSync(
      `"/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister" -f "${APP_DIR}"`,
      { stdio: "ignore" },
    );
  } catch {
    // ignore
  }

  try {
    execSync(`touch "${APP_DIR}"`, { stdio: "ignore" });
  } catch {
    // ignore
  }
}

function bootoutLaunchAgent() {
  try {
    execSync(`launchctl bootout gui/$(id -u) "${PLIST}"`, { stdio: "ignore" });
  } catch {
    // not loaded
  }
}

function writeLaunchAgent() {
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.writeFileSync(
    PLIST,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${LAUNCH}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>StandardOutPath</key>
  <string>${HOME}/Library/Logs/agent-widget.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/Library/Logs/agent-widget.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${HOME}/.local/bin</string>
  </dict>
</dict>
</plist>
`,
  );

  bootoutLaunchAgent();
  execSync(`launchctl bootstrap gui/$(id -u) "${PLIST}"`, { stdio: "ignore" });
  try {
    execSync(`launchctl enable gui/$(id -u)/${LABEL}`, { stdio: "ignore" });
  } catch {
    // ignore
  }
}

function isOpenAtLogin() {
  return fs.existsSync(PLIST);
}

/** Install app bundle + LaunchAgent (open at login). */
function install() {
  ensureLaunchScriptExecutable();
  writeAppBundle();
  writeLaunchAgent();
  return { appDir: APP_DIR, plist: PLIST };
}

/** Disable open-at-login only; keep ~/Applications/Agent Widget.app. */
function uninstallLogin() {
  bootoutLaunchAgent();
  try {
    fs.rmSync(PLIST, { force: true });
  } catch {
    // ignore
  }
}

/** Remove LaunchAgent and the helper .app (full uninstall). */
function uninstallAll() {
  uninstallLogin();
  try {
    fs.rmSync(APP_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function setOpenAtLogin(enabled) {
  if (enabled) {
    install();
  } else {
    uninstallLogin();
  }
  return isOpenAtLogin();
}

module.exports = {
  APP_NAME,
  APP_DIR,
  LABEL,
  PLIST,
  LAUNCH,
  ROOT,
  isOpenAtLogin,
  install,
  uninstallLogin,
  uninstallAll,
  setOpenAtLogin,
};
