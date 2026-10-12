# Manual end-to-end checklist

Run on a real Houdini before calling a release good. Record the result at the
bottom with host, Houdini build, display server, GPU and pi version.

## Setup

1. `./install` reports `dependencies ok`, builds, writes
   `$HOUDINI_USER_PREF_DIR/packages/houdini_pi.json`.
2. fxhoudinimcp's Houdini plugin is installed (`uvx --from
   git+https://github.com/healkeiser/fxhoudinimcp@v2.25.0 fxhoudinimcp
   houdini-package --write ~/houdiniXX.Y/packages`).
3. `pi` is logged in or has provider keys (`pi` in a terminal, `/login`).

## Checks

- [ ] Launch Houdini. The **houdini-pi** menu exists. **Open Agent Pane**
      shows the pane, status reads `open`, the hip name is right.
- [ ] `~/.houdini-pi/sidecar-<port>.log` shows `sidecar listening`.
- [ ] The model picker lists the models pi knows. Switching one sticks.
- [ ] Prompt "create a box in /obj and scale it to 2 m". A `houdini:
      create_node` card appears, the box exists, the footer shows cost and
      duration.
- [ ] **One** Ctrl-Z in Houdini removes everything the turn did.
- [ ] Memory tab: add a line, save, reload the pane, the line is there. Save
      the hip, reopen it, the line is still there.
- [ ] Prompt "remember that boxes here are always 2 m" → a `memory_append`
      card; the Memory tab shows the new bullet.
- [ ] Open a second pane: both show the same conversation.
- [ ] Close both panes, reopen: history is back, same session id.
- [ ] Quit Houdini: `pgrep -f houdini-pi/sidecar` finds nothing within 5 s.
- [ ] Two Houdinis at once: each pane talks to its own scene (edit in one does
      not show in the other).
- [ ] With Houdini's bridge stopped (`FXHOUDINIMCP_AUTOSTART=0`), a prompt
      shows an error notice with a reconnect action, not a hang.
- [ ] `QWebEngineView` renders (not black). If black, note whether
      `QTWEBENGINE_CHROMIUM_FLAGS=--disable-gpu` fixes it.

## Results

| date | host | Houdini | display | GPU | pi | result |
|---|---|---|---|---|---|---|
| | | | | | | not yet run |
