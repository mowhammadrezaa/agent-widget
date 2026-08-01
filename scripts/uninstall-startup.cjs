#!/usr/bin/env node
const { APP_NAME, uninstallAll } = require("./startup-lib.cjs");

uninstallAll();
console.log(`Removed login agent and ~/Applications/${APP_NAME}.app`);
