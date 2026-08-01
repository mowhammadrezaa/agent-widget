#!/usr/bin/env node
/**
 * electron's extract-zip can leave an incomplete dist on some macOS setups.
 * Ensure Frameworks exist; if not, unzip from the electron cache or re-download.
 * No-op on Windows/Linux — npm's electron install is sufficient there.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const os = require("os");

if (process.platform !== "darwin") {
  process.exit(0);
}

const electronRoot = path.join(__dirname, "..", "node_modules", "electron");
const dist = path.join(electronRoot, "dist");
const framework = path.join(
  dist,
  "Electron.app",
  "Contents",
  "Frameworks",
  "Electron Framework.framework",
  "Electron Framework",
);
const pathTxt = path.join(electronRoot, "path.txt");
const platformPath = "Electron.app/Contents/MacOS/Electron";

function ok() {
  return fs.existsSync(framework) && fs.existsSync(pathTxt);
}

if (ok()) {
  process.exit(0);
}

console.log("Repairing Electron binary…");

const { version } = require(path.join(electronRoot, "package.json"));
const cacheRoot = path.join(os.homedir(), "Library", "Caches", "electron");
let zip = null;

if (fs.existsSync(cacheRoot)) {
  const finds = execSync(
    `find "${cacheRoot}" -name "electron-v${version}-darwin-*.zip" 2>/dev/null | head -1`,
    { encoding: "utf8" },
  ).trim();
  if (finds) zip = finds;
}

if (!zip) {
  // Trigger download into cache, then locate zip.
  try {
    execSync("node install.js", {
      cwd: electronRoot,
      stdio: "inherit",
      env: { ...process.env, force_no_cache: "true" },
    });
  } catch {
    // continue — may still be incomplete
  }
  if (ok()) process.exit(0);

  const finds = execSync(
    `find "${cacheRoot}" -name "electron-v${version}-darwin-*.zip" 2>/dev/null | head -1`,
    { encoding: "utf8" },
  ).trim();
  if (finds) zip = finds;
}

if (!zip || !fs.existsSync(zip)) {
  console.error("Could not locate Electron zip to repair install.");
  process.exit(1);
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
execSync(`unzip -q "${zip}" -d "${dist}"`, { stdio: "inherit" });
fs.writeFileSync(pathTxt, platformPath);

if (!ok()) {
  console.error("Electron repair failed.");
  process.exit(1);
}

console.log("Electron ready.");
