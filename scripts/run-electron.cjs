#!/usr/bin/env node
/**
 * Run an Electron script without Cursor-injected ELECTRON_RUN_AS_NODE.
 */
const { spawn } = require("child_process");
const electron = require("electron");

const args = process.argv.slice(2);
if (!args.length) {
  console.error("Usage: node scripts/run-electron.cjs <script> [args…]");
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;

const child = spawn(electron, args, {
  stdio: "inherit",
  env,
  windowsHide: false,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
