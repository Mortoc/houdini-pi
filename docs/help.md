---
title: Pi for Houdini
---

# Pi for Houdini

A chat pane whose agent edits your live scene. Every turn is one Ctrl-Z.

## The pane

- **Filename · conversation name**: the hip you are in, and the name the
  conversation got after your first message.
- **chat / memory / sessions**: the conversation, the project memory stored
  in this hip, and earlier conversations for this hip.
- **Link Pane Tab**: put the Pi tab and a network editor or parameter view in
  the same link group (1–9) and they follow the node the agent works on. *Last
  Selected Node* works too, since the agent selects what it touches.
- **Model**: type to search. Only models that can see images are listed, so
  the agent can check its own renders.
- **thinking**: how much the model reasons before acting.
- **New Conversation**: fresh context for the same hip.

## What a turn does

1. Writes a Houdini backup before the first change (`$HOUDINI_BACKUP_DIR`).
2. Opens one undo group, so **one Ctrl-Z reverts the whole turn**. The footer
   also has "undo this turn in Houdini".
3. Selects and shows each node it touches, at least half a second apart.
4. In a Copernicus network, renders the output and looks at it before
   finishing. You see the thumbnail; click to expand.
5. Ends with a green **Done**, or the count of tool errors. No summaries.

## Tool cards

- Click a card to open it. Scripts (`execute_python`, `codemode`) show the
  code, four lines tall, scrollable, with a copy button.
- A successful `execute_python` shows nothing more. A failure shows the
  exception; warnings on stderr show in yellow.
- Dragging nodes from a network editor onto the pane adds them as references
  to your next message.

## Memory

Markdown stored inside the hip, shown to the agent every turn. Decisions,
naming conventions, what a node is for. The agent appends to it; you can edit
it in the **memory** tab. It compacts itself past ~16k tokens, with one-step
rollback.

## Settings

`~/.houdini-pi/settings.json`:

```json
{
  "naming": { "model": "cheapest", "renameAtUserMessages": [1, 5] },
  "followNodes": true
}
```

## When something is wrong

- **Starting the houdini-pi sidecar…** never ends: read
  `~/.houdini-pi/sidecar-<port>.log`. The pane shows the last lines after 30 s.
- **no Houdini bridge**: the fxhoudinimcp plugin is not loaded. Check
  `~/houdini22.0/packages/fxhoudinimcp.json`.
- **login** notice: run `pi` in a terminal and `/login`, or export the
  provider key before launching Houdini.
- Black pane: `QTWEBENGINE_CHROMIUM_FLAGS=--disable-gpu houdini`.

Source and issues: <https://github.com/Mortoc/houdini-pi>.
