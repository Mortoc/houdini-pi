# houdini-pi

An in-Houdini chat agent built on [pi](https://github.com/badlogic/pi-mono).
A dockable pane that talks to the LLM of your choice, which edits the live
scene through [fxhoudinimcp](https://github.com/healkeiser/fxhoudinimcp).
Every turn is one undo step. The agent sees where you are in the scene and
keeps a curated memory inside the `.hip`.

Status: design approved, implementation starting. See
[docs/specs/2026-10-12-houdini-pi-design.md](docs/specs/2026-10-12-houdini-pi-design.md).

## Requirements

- Houdini 22.0+
- Node 22.19+
- pi 1.x (`builtin:mcp`), logged in or with provider keys configured
- uv
- the fxhoudinimcp Houdini plugin

## Install

```
git clone https://github.com/Mortoc/houdini-pi ~/houdini-pi
cd ~/houdini-pi && ./install
```

Then in Houdini: **houdini-pi ▸ Open Agent Pane**.

## License

MIT
