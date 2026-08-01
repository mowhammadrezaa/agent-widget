#!/bin/zsh
# Launch the Agent Widget (safe from Terminal, Shortcuts, Login Items, etc.)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
unset ELECTRON_RUN_AS_NODE
unset ELECTRON_NO_ATTACH_CONSOLE

ELECTRON_BIN="$ROOT/node_modules/.bin/electron"
if [[ ! -x "$ELECTRON_BIN" ]]; then
  echo "Electron is not installed. Run: cd \"$ROOT\" && npm install" >&2
  exit 1
fi

# Ensure native module is present (no-op if already built).
if [[ ! -e "$ROOT/node_modules/node-pty/build/Release/pty.node" ]]; then
  npm run rebuild >/dev/null 2>&1 || true
fi

exec "$ELECTRON_BIN" "$ROOT"
