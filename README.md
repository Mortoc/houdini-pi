# houdini-pi

A chat agent inside Houdini. A dockable **Houdini Agent** pane talks to the
LLM of your choice, which edits the live scene through
[fxhoudinimcp](https://github.com/healkeiser/fxhoudinimcp). The agent is
[pi](https://github.com/badlogic/pi-mono), run by a local sidecar. Every turn
is one undo step; the agent looks at its own renders, follows along in your
panes, and keeps a project memory inside the `.hip`.

Help page: <https://mortoc.github.io/houdini-pi/help> (the pane's **?**).

## Requirements

| | version | notes |
|---|---|---|
| Houdini | 22.0+ | Python 3.13 with QtWebEngine, as shipped |
| Node | 22.19+ | runs the sidecar; pinned into the package file at install, so Houdini's PATH does not matter |
| pi | 1.x | the agent; log in once (`pi`, then `/login`) or set a provider key |
| uv | any | runs the fxhoudinimcp MCP server via `uvx` |

## Install

1. This plugin, and the fxhoudinimcp bridge it drives:

   ```
   git clone https://github.com/Mortoc/houdini-pi ~/houdini-pi
   cd ~/houdini-pi && ./install
   ```

   `./install` checks the requirements (and names what is missing), builds the
   sidecar and UI, installs the fxhoudinimcp bridge as a `uv tool`, and writes
   `~/houdini22.0/packages/houdini_pi.json`; `./install --uninstall` removes
   that file. The bridge goes in as a `uv tool` rather than upstream's
   `uvx --from … houdini-package` one-liner, which writes a package file
   pointing into uv's cache, where `uv cache clean` deletes it.

2. Start Houdini. **Windows ▸ Squatch Studios ▸ Houdini Agent**, or add a
   **Houdini Agent** tab to any pane (New Pane Tab Type ▸ Houdini Agent).

NixOS: `nix build .#houdini-pi` builds the plugin and `.#houdini-pi-package-json`
is the package file to install with home-manager.

## Using it

- **Ask for a change** and watch it happen. Tool cards show each step; a green
  **Done** ends the turn. **■ stop** halts it; **↶ Undo** then reverts the turn
  in Houdini and puts your message back in the box. One Ctrl-Z also reverts a
  whole turn.
- **Ask a question** ("how do I…") and you get an answer block with buttons
  that select the node, show the parameter, jump to the network, open a pane or
  a help page.
- **Reference things** by dragging nodes or parameters from any pane onto the
  chat; they become chips on your next message.
- **Follow along**: the node the agent touches becomes the selection. Set the
  pane's link group (toolbar dropdown) to match a network editor and parameter
  view, and they jump with it.
- **Renders**: after editing a Copernicus network the agent renders its output
  and checks the image before finishing (thumbnail in the card, click to
  expand). It can screenshot the viewport the same way.
- **Backups**: a Houdini backup is written before the first edit of each turn.
- **Memory tab**: markdown stored in the hip and shown to the agent every turn.
  Decisions, conventions, node roles. Edit it directly.
- **Sessions tab**: earlier conversations, grouped by scene. Opening the pane
  always starts a new conversation; opening an old one also opens its hip.
- **Models**: searchable picker; only image-capable models are listed. New
  conversations start on DeepSeek V4 Flash Vision.

## Settings

`~/.houdini-pi/settings.json`, all optional:

```json
{
  "defaultModel": ["openrouter/deepseek/deepseek-v4-flash-vision-exp", "openrouter/deepseek/deepseek-v4.1-flash"],
  "naming": { "model": "cheapest", "renameAtUserMessages": [1, 5] },
  "followNodes": true,
  "pane": { "softwareRender": false }
}
```

- `defaultModel`: first available wins; a resumed conversation keeps its own.
- `naming`: which model names conversations, and after which user messages.
- `followNodes`: selection and linked panes follow the agent.
- `pane.softwareRender`: render the pane without the GPU (also
  `HOUDINI_PI_SOFTWARE_RENDER=1`). For a black pane, or when the GPU is full.

## From the terminal

The same workflow in the pi CLI:

```
pi install git:github.com/Mortoc/houdini-pi
HOUDINI_PI_PORT=8100 pi
```

Adds `/scene`, `/memory`, `/undo-turn`, `/inspect-cop <node>`; the fxhoudini
MCP server is registered automatically.

## Troubleshooting

- **Starting the houdini-pi sidecar…** never finishes: the pane shows the end of
  `~/.houdini-pi/sidecar-<port>.log` after 30 s.
- **no Houdini bridge**: the fxhoudinimcp plugin is not loaded. Re-run `./install`, then restart Houdini.
- **login** notice: run `pi` in a terminal and `/login`.
- **Black pane**: set `pane.softwareRender` (above).

## Development

```
nix develop                          # or Node 22, uv, Python 3.12 on PATH
npm ci
npm test                             # vitest
npm run test:py                      # pytest
npm run build && npm run test:e2e    # Playwright against the fake-agent sidecar
```

UI with hot reload: `node sidecar/dist/src/index.js --fake-agent --port 9123 --token dev`,
then `npm run dev -w ui` and open `http://127.0.0.1:5173/?token=dev`.

Manual checks on a real Houdini: [docs/manual-e2e.md](docs/manual-e2e.md).
Design: [docs/specs/](docs/specs/).

## License

MIT
