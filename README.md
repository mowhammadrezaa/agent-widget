# Agent Widget

Floating desktop widget for AI agent CLIs — a collapsed pill that expands into a real terminal running Cursor’s `agent`, Claude Code, or any custom command.

<p align="center">
  <img src="docs/screenshots/pill.png" alt="Collapsed Agent Widget pill" width="240" />
</p>

<p align="center">
  <img src="docs/screenshots/panel.png" alt="Expanded Agent Widget terminal panel" width="720" />
</p>

## Features

- **Tabs** — open multiple sessions per agent; tabs persist across restarts until you close them
- **Pill → panel** — collapsed capsule; click to expand a full PTY terminal
- **Real agents** — Cursor (`agent`), Claude (`claude`), plus custom commands
- **Always on top** — optional floating mode with click-through around the pill
- **Open at login** — toggle in the panel (and during the macOS installer)
- **Workspace picker** — choose the cwd the agent runs in
- **Global toggle** — `⌘⇧A` (macOS) / `Ctrl+Shift+A` (Windows & Linux) while the app is running
- **Tray menu** — show, always-on-top, open at login, quit
- **Background app** — no Dock icon on macOS (`LSUIElement`); tray-first elsewhere

## Requirements

- **macOS** 13+, **Windows** 10+, or a modern **Linux** desktop (X11; Wayland varies)
- An agent CLI on your `PATH` (`agent` / `cursor-agent` and/or `claude`)
- For the **source** path: Node.js 18+ and git

## Download

Grab the latest build for your OS from [Releases](https://github.com/mowhammadrezaa/agent-widget/releases) (built automatically on every push to `master`, or run `npm run dist` locally).

You still need a Cursor (`agent`) or Claude (`claude`) CLI installed for the widget to talk to an agent.

### macOS

1. Download **Agent Widget-*-mac-*.dmg**
2. Open the DMG and drag **Agent Widget** into **Applications**
3. In Finder → Applications, **Control-click** Agent Widget → **Open** → **Open**  
   (or double-click once to get blocked, then **System Settings → Privacy & Security** → **Open Anyway**)

Builds are **ad-hoc signed** (not Apple Developer ID / notarized). Gatekeeper will warn on first launch; that is expected.

### Windows

1. Download **Agent Widget-*-win-*.exe**
2. Run the NSIS installer and follow the prompts
3. If **Windows SmartScreen** appears, click **More info** → **Run anyway** (builds are unsigned)

Launch from the Start Menu or the desktop shortcut.

### Linux

1. Download **Agent Widget-*-linux-*.AppImage**
2. Make it executable and run:

```bash
chmod +x Agent\ Widget-*-linux-*.AppImage
./Agent\ Widget-*-linux-*.AppImage
```

Some desktops need an AppIndicator / StatusNotifier package for the tray icon (e.g. `libappindicator` / `ayatana-appindicator` on Debian/Ubuntu).

## Install from source

### macOS

```bash
git clone https://github.com/mowhammadrezaa/agent-widget.git agent-widget
cd agent-widget
./install              # choose Auto or Custom
./install --auto       # defaults, no questions
./install --custom     # ask every preference
```

**Auto** installs deps if needed, uses sensible defaults (workspace, Cursor agent, always on top, open at login), creates `~/Applications/Agent Widget.app`, and launches.

**Custom** asks each preference interactively.

### Windows

```powershell
git clone https://github.com/mowhammadrezaa/agent-widget.git agent-widget
cd agent-widget
npm install
npm start
```

Build an installer (on Windows):

```powershell
npm run dist:win
```

The NSIS `.exe` lands in `release/`.

### Linux

```bash
git clone https://github.com/mowhammadrezaa/agent-widget.git agent-widget
cd agent-widget
npm install
npm start
```

Build an AppImage (on Linux):

```bash
npm run dist:linux
```

The `.AppImage` lands in `release/`.

### Build packages (maintainers)

| Command | Output |
| --- | --- |
| `npm run dist` | Package for the **current** OS |
| `npm run dist:mac` | macOS DMG |
| `npm run dist:win` | Windows NSIS installer |
| `npm run dist:linux` | Linux AppImage |
| `npm run dist:dir` | Unpackaged app dir (smoke tests) |

CI builds all three on every push to `master`.

## Usage

| Action | How |
| --- | --- |
| Open | Click the pill, or tray **Show Agent** |
| Move | Drag the pill |
| Collapse | Move the pointer away, press `Esc`, or the − control |
| Quit | ✕ on the pill/panel, or tray **Quit** |
| Toggle | `⌘⇧A` (macOS) / `Ctrl+Shift+A` (Windows & Linux) |
| Switch agent | Dropdown opens that agent in a **new** tab (current tab stays) |
| New tab | ＋ on the tab bar (uses the selected agent) |
| Close tab | × on a tab, or **Close all** |
| Add agent | ＋ next to the agent dropdown, then enter a command (e.g. `codex`) |

### macOS

Also open with `open -a "Agent Widget"` (after install).

### Windows

Open from **Start → Agent Widget**, or the desktop shortcut after installing the `.exe`.

### Linux

Run the AppImage again, or pin/launch from your desktop environment if you installed a `.desktop` entry.

## Configuration

Stored at `~/.agent-widget.json` (on Windows: `%USERPROFILE%\.agent-widget.json`):

| Key | Meaning |
| --- | --- |
| `workspace` | Agent working directory |
| `agentId` | Active agent (`cursor`, `claude`, or custom id) |
| `tabs` | Open sessions `{ id, agentId }` — restored across restarts |
| `activeTabId` | Selected tab |
| `alwaysOnTop` | Float above other windows |
| `customAgents` | User-defined `{ id, label, command }` entries |

Tab scrollback is stored separately at `~/.agent-widget-buffers.json` so sessions survive quit/relaunch (the live PTY still starts fresh).

### macOS-only (source install)

- Login item: `~/Library/LaunchAgents/com.agent-widget.plist`
- App shortcut: `~/Applications/Agent Widget.app`

### Linux (packaged)

- Autostart file when “Open at login” is on: `~/.config/autostart/agent-widget.desktop`

## Scripts

| Command | Description |
| --- | --- |
| `./install` | macOS: Auto or Custom install |
| `./install --auto` | macOS: silent install with defaults |
| `./install --custom` | macOS: ask every install preference |
| `./uninstall` | macOS: Auto or Custom uninstall |
| `./uninstall --auto` | macOS: remove app, login, config, logs |
| `./uninstall --custom` | macOS: pick what to remove |
| `npm run dist` | Build package for the current OS |
| `npm run dist:mac` | Build ad-hoc signed macOS DMG |
| `npm run dist:win` | Build Windows NSIS installer |
| `npm run dist:linux` | Build Linux AppImage |
| `npm run dist:dir` | Build unpackaged app for smoke tests |
| `npm start` | Run from the repo |
| `npm run rebuild` | Rebuild `node-pty` for Electron |
| `npm run screenshots` | Refresh README screenshots |

## Uninstall

### macOS

```bash
./uninstall            # choose Auto or Custom
./uninstall --auto     # remove app, login, config, logs
./uninstall --custom   # pick what to remove
```

The git repo is never deleted automatically.

### Windows

Use **Settings → Apps → Installed apps** (or the installer uninstall entry) to remove the packaged app. Delete `%USERPROFILE%\.agent-widget.json` and `%USERPROFILE%\.agent-widget-buffers.json` if you also want config/scrollback gone.

### Linux

Delete the AppImage. Remove `~/.config/autostart/agent-widget.desktop` if present. Delete `~/.agent-widget.json` and `~/.agent-widget-buffers.json` to clear config/scrollback.

## Development

```bash
npm install
npm start
```

Main process: `electron/main.cjs` · Preload: `electron/preload.cjs` · UI: `src/`

## Troubleshooting

| Issue | Fix |
| --- | --- |
| Electron won’t start from Cursor’s terminal | Use `npm start` (clears `ELECTRON_RUN_AS_NODE`), or the packaged app |
| Agent not found | Install the CLI, ensure it’s on `PATH`, then hit Restart |
| Pill not clickable | Turn **always on top** on, or click the tray icon |
| Native module errors | `npm run rebuild` |
| Linux tray missing | Install an AppIndicator package for your desktop |
| Windows SmartScreen / macOS Gatekeeper | Expected for unsigned / ad-hoc builds — use Run anyway / Open Anyway |

## License

[MIT](LICENSE) — free to use, modify, sell, and redistribute, as long as you keep the copyright notice and clearly indicate the original source repository.
