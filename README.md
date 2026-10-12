# houdini-pi

An in-Houdini chat agent built on [pi](https://github.com/badlogic/pi-mono).
A dockable pane that talks to the LLM of your choice, which edits the live
scene through [fxhoudinimcp](https://github.com/healkeiser/fxhoudinimcp).
Every turn is one undo step. The agent sees where you are in the scene and
keeps a curated memory inside the `.hip`.

Design: [docs/specs/2026-10-12-houdini-pi-design.md](docs/specs/2026-10-12-houdini-pi-design.md).
Plan: [docs/plans/2026-10-12-houdini-pi.md](docs/plans/2026-10-12-houdini-pi.md).

## Requirements

| | minimum | why |
|---|---|---|
| Houdini | 22.0 | Python 3.13, PySide6 with QtWebEngine |
| Node | 22.19 | runs the sidecar and the pi library |
| pi | 1.0 | `builtin:mcp`; log in once with `pi` → `/login`, or set provider keys |
| uv | any | runs the fxhoudinimcp MCP server with `uvx` |
| fxhoudinimcp Houdini plugin | v2.25.0 | the bridge on `127.0.0.1:8100` |

Install the fxhoudinimcp Houdini plugin with upstream's one-liner:

```
uvx --from git+https://github.com/healkeiser/fxhoudinimcp@v2.25.0 fxhoudinimcp houdini-package --write ~/houdini22.0/packages
```

## Install

```
git clone https://github.com/Mortoc/houdini-pi ~/houdini-pi
cd ~/houdini-pi && ./install
```

`./install` checks the dependencies above, runs `npm ci && npm run build`, and
writes `$HOUDINI_USER_PREF_DIR/packages/houdini_pi.json`. `./install --uninstall`
removes that file. Then in Houdini: **Windows ▸ Squatch Studios ▸ Houdini Agent**, or add a **Houdini Agent** tab to
any pane (New Pane Tab Type ▸ Houdini Agent) like the Geometry Spreadsheet.

NixOS: `nix build .#houdini-pi` builds the plugin; `.#houdini-pi-package-json`
is the package file pointing at it, for a home-manager `home.file` entry.

## Using the pane

- **Model picker**: type to search, arrows and Enter to pick. It lists
  whatever pi has credentials for; auth is pi's, never stored here.
- **Conversation name**: starts as "New Conversation"; the cheapest priced
  model names it after your first message and again at your fifth. Configure
  in `~/.houdini-pi/settings.json`:
  `{"naming": {"model": "cheapest" | "provider/model-id", "renameAtUserMessages": [1, 5]}}`.
- **Backup before the agent edits**: once per turn, before the first tool call
  that can change the scene, a Houdini backup is written
  (`hou.hipFile.saveAsBackup`, into `$HOUDINI_BACKUP_DIR`).
- **Follow the agent**: the node a tool touched becomes the selection, so
  panes set to *Last Selected Node* follow. Put the Pi tab and a network
  editor or parameter view in the same **Link Pane Tab** group (1–9) and they
  jump to the node's network and parameters as the agent works.
  Selections are shown at least 500 ms apart so you can see each step.
  `{"followNodes": false}` in the settings file turns this off.
- **No summaries**: the agent ends a turn silently; a green **Done** line (or
  the tool error count) tells you how it went.
- **COP inspection**: `inspect_cop` renders a Copernicus node to a 256 px PNG
  through a temporary File Output COP and returns the image to the model; the
  card shows a thumbnail, click to expand. The agent is
  made to call it after any COP change before it may finish; the picture shows
  up in the tool card. You can trigger it too: `/inspect-cop /obj/copnet/out`
  in the pi CLI. Images are stored with the conversation under `~/.houdini-pi/assets/<session>/`, so a reloaded conversation still shows them. `inspect_viewport` does the same for the scene viewer.
- **Models**: only models that accept images are offered, because the agent
  has to look at renders.
- **Reference nodes**: drag nodes from the network editor onto the pane; they
  become chips that ride along with your next message.
- **Each turn is one Ctrl-Z** in Houdini. The footer also offers "undo this
  turn".
- **Memory tab**: markdown stored in the `.hip` (root node user data), shown to
  the agent every turn. Decisions, conventions, node roles. The agent writes
  to it with `memory_append`; you can edit it directly. It compacts itself past
  ~16k tokens, with one-step rollback.
- **Sessions tab**: conversations for this hip. Reopening a hip resumes its
  last session.
- pi's own file tools (`bash`, `edit`, `write`) are off: the agent works on
  the scene through Houdini. `HOUDINI_PI_FILE_TOOLS=1` enables them in the CLI.

## From the terminal

The same workflow works in the pi CLI:

```
pi install git:github.com/Mortoc/houdini-pi
HOUDINI_PI_PORT=8100 pi
```

`/scene`, `/memory`, `/undo-turn` are added; the fxhoudini MCP server is
registered automatically.

## How it works

```
Houdini pane (QWebEngineView) ⇄ Node sidecar (pi SDK in-process) ⇄ Houdini :8100 bridge
```

The panel starts one sidecar per Houdini (port `9100 + pid % 400`), detached,
exiting when Houdini does. The page carries a per-launch token every WebSocket
upgrade must present. Everything binds `127.0.0.1`.

## Development

```
nix develop            # or: Node 22, uv, Python 3.12 on PATH
npm ci
npm test               # vitest: protocol, sidecar, pi extension
npm run test:py        # pytest: houdini/ helpers, installer
npm run build && npm run test:e2e   # Playwright against the fake-agent sidecar
```

UI with hot reload: `node sidecar/dist/src/index.js --fake-agent --port 9123
--token dev` in one terminal, `npm run dev -w ui` in another, open
`http://127.0.0.1:5173/?token=dev`.

Manual checks on a real Houdini: [docs/manual-e2e.md](docs/manual-e2e.md).

## Troubleshooting

- **Black pane**: a known QtWebEngine-in-DCC failure. Try
  `QTWEBENGINE_CHROMIUM_FLAGS=--disable-gpu houdini`.
- **"no Houdini bridge"**: the fxhoudinimcp plugin is not loaded or
  `FXHOUDINIMCP_AUTOSTART=0`. Check `~/houdini22.0/packages`.
- **Login errors**: run `pi` in a terminal and `/login`, or export the
  provider's API key before launching Houdini.
- Sidecar logs: `~/.houdini-pi/sidecar-<port>.log`.

## License

MIT
