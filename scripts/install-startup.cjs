#!/usr/bin/env node
/**
 * Installs:
 * 1) ~/Applications/Agent Widget.app  — open via Spotlight / keyboard shortcut
 * 2) LaunchAgent                      — start at login
 */
const {
  APP_NAME,
  APP_DIR,
  PLIST,
  install,
} = require("./startup-lib.cjs");

install();

console.log(`
Installed:

  App:          ${APP_DIR}
  Login agent:  ${PLIST}

Open now:
  open -a "${APP_NAME}"

Keyboard shortcut (when the widget is quit):
  1. Open the Shortcuts app
  2. New Shortcut → action "Open App" → choose "Agent Widget"
  3. File → Add Keyboard Shortcut → pick keys (e.g. ⌃⌥⌘A)

While the widget is already running, ⌘⇧A still toggles it.
`);
