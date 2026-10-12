---
title: Pi for Houdini
---

# Pi for Houdini

A chat pane whose agent edits your live scene. Every turn is one Ctrl-Z.

## The pane

- **Filename · conversation name**: the hip you are in, and the name the
  conversation got after your first message.
- **chat / memory / sessions**: the conversation, the project memory stored
  in this hip, and earlier conversations grouped by scene. Opening the pane
  always starts a new conversation; opening an earlier one also opens the hip
  it worked on (save your current scene first).
- **Link Pane Tab**: put the Pi tab and a network editor or parameter view in
  the same link group (1–9) and they follow the node the agent works on. *Last
  Selected Node* works too, since the agent selects what it touches.
- **Model**: type to search. Only models that can see images are listed, so
  the agent can check its own renders. A new conversation starts on the first
  available entry of `defaultModel` in the settings file (DeepSeek V4 Flash
  Vision by default); a resumed one keeps the model it had.
- **thinking**: how much the model reasons before acting.
- **New Conversation**: fresh context for the same hip.

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

Markdown stored inside the hip, shown to the agent every turn. Decisions,
naming conventions, what a node is for. The agent appends to it; you can edit
it in the **memory** tab. It compacts itself past ~16k tokens, with one-step
rollback.

## Settings

`~/.houdini-pi/settings.json`:

```json
{
  "naming": { "model": "cheapest", "renameAtUserMessages": [1, 5] },
  "followNodes": true,
  "defaultModel": ["openrouter/deepseek/deepseek-v4-flash-vision-exp", "openrouter/deepseek/deepseek-v4.1-flash"]
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
