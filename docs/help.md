---
title: Pi for Houdini
---

# Pi for Houdini

A chat pane whose agent edits your live scene. Every turn is one Ctrl-Z.

## The pane

- **Conversation name · cost**: the name the conversation got after your
  first message, and what it has cost so far (USD).
- **chat / memory / sessions**: the conversation, the hip memory stored
  in this .hip (plus the project memory shared across $JOB), and earlier
  conversations this hip has had (stored in the .hip, so Save As keeps them).
  Opening the pane always starts a new conversation.
- **Link Pane Tab**: put the Pi tab and a network editor or parameter view in
  the same link group (1–9) and they follow the node the agent works on.
- **Model**: shows "Default" until you pick one; type to search. Only models that can see images are listed, so
  the agent can check its own renders. A new conversation starts on the first
  available entry of `defaultModel` in the settings file (DeepSeek V4 Flash
  Vision by default); a resumed one keeps the model it had.
- **thinking** (under the send button): how much the model reasons before acting.
- **+**: a new conversation, fresh context for the same hip.

## What a turn does

1. Writes a Houdini backup before the first change (`$HOUDINI_BACKUP_DIR`).
2. Opens one undo group, so **one Ctrl-Z reverts the whole turn**.
3. Selects and shows each node it touches, at least half a second apart.
4. In a Copernicus network, renders the output and looks at it before
   finishing. It can screenshot the viewport the same way. You see the
   thumbnail; click to expand. Images are kept with the conversation
   (`~/.houdini-pi/assets/<session>/`), so they are still there when you reopen it.
5. Ends with a green **Done**, or the count of tool errors. No summaries.
   **■ stop** (on the activity line) halts the turn; **↶ Undo** then reverts
   everything the turn did in Houdini and puts your message back in the box.
   **steer** sends a message into the running turn.

## Questions and tutorials

Ask "how do I…" or "why…" and the agent answers in a highlighted block instead
of editing the scene. Steps come with buttons: **◎ select** a node, **⚙** show
a parameter, **⌂** go to a network, **▣** open a pane, **?** open a help page.
A struck-through button points at something that does not exist in this
scene; hover it for the reason. Anything the model wrote outside the answer is
tucked under "unformatted reply".

## Tool cards

- Click a card to open it. Scripts (`execute_python`, `codemode`) show the
  code, four lines tall, scrollable, with a copy button.
- A successful `execute_python` shows nothing more. A failure shows the
  exception; warnings on stderr show in yellow.
- Dragging nodes from a network editor onto the pane adds them as references
  to your next message.

## Memory

Two scopes, both shown to the agent every turn:

- **Hip memory** — stored inside the .hip file. Per-scene decisions, naming
  conventions for these nodes, what a node is for. The agent appends to it;
  you can edit it in the **memory** tab. It compacts itself past ~16k tokens,
  with one-step rollback.
- **Project memory** — stored at `$JOB/.houdini-pi/memory.md`, shared across
  every hip in the project. Team conventions, pipeline rules, "do not do X"
  that applies everywhere. Only really important things belong here. Edit it
  in the **memory** tab, below the hip memory. Unavailable when `$JOB` is not
  set.

## Settings

`~/.houdini-pi/settings.json`:

```json
{
  "naming": { "model": "cheapest", "renameAtUserMessages": [1, 5] },
  "followNodes": true,
  "defaultModel": ["openrouter/deepseek/deepseek-v4-flash-vision-exp", "openrouter/deepseek/deepseek-v4.1-flash"],
  "layout": { "autoLayout": false }
}
```

`layout.autoLayout` sets `FXHOUDINIMCP_AUTO_LAYOUT` for the bridge. **Off** (default): freshly-created nodes are placed beside their inputs, but existing node positions never move. **On**: `create_node` re-lays-out the entire network (`layoutChildren()` on all children), and the `layout_children` tool becomes callable. Also settable with `HOUDINI_PI_AUTO_LAYOUT=1` in the environment.

## When something is wrong

- **Starting the houdini-pi sidecar…** never ends: read
  `~/.houdini-pi/sidecar-<port>.log`. The pane shows the last lines after 30 s.
- **no Houdini bridge**: the fxhoudinimcp plugin is not loaded. Check
  `~/houdini22.0/packages/fxhoudinimcp.json`.
- **login** notice: run `pi` in a terminal and `/login`, or export the
  provider key before launching Houdini.
- Black pane: `QTWEBENGINE_CHROMIUM_FLAGS=--disable-gpu houdini`.

Source and issues: <https://github.com/Mortoc/houdini-pi>.
