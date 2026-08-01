#!/usr/bin/env node
/**
 * Launch Electron without Cursor-injected ELECTRON_RUN_AS_NODE.
 * Cross-platform replacement for `env -u … electron .`
 */
const { spawn } = require("child_process");
const electron = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;

const child = spawn(electron, ["."], {
  stdio: "inherit",
  env,
  windowsHide: false,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
