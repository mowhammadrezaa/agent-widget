#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const HOME = os.homedir();
const APP_NAME = "Agent Widget";
const APP_DIR = path.join(HOME, "Applications", `${APP_NAME}.app`);
const LABEL = "com.cursor.agent-widget";
const PLIST = path.join(HOME, "Library", "LaunchAgents", `${LABEL}.plist`);

try {
  execSync(`launchctl bootout gui/$(id -u) "${PLIST}"`, { stdio: "ignore" });
} catch {
  // not loaded
}

for (const target of [PLIST, APP_DIR]) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

console.log("Removed login agent and ~/Applications/Agent Widget.app");
