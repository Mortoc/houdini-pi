# Decisions taken autonomously, overnight 2026-10-12

Each entry: decision, options weighed, why. Review in the morning.

1. **Work on a branch + PR, not straight to main.** Options: push task commits
   to `main` (repo is brand new, nobody else on it) vs branch
   `feature/initial-implementation` + PR. Chose the PR: it gives a single place
   to review the overnight run and CI runs against it.
2. **Dev toolchain comes from the repo's own `flake.nix` devShell** (Node 22,
   uv, Python 3.12, playwright-driver browsers). Options: rely on the host's
   `~/.nix-profile` node (20.x, too old for pi) vs the flake. The flake is also
   what SquatchLinux will consume, so it was needed anyway.
3. **`@playwright/test` pinned to nixpkgs' `playwright-driver` version (1.61.1)**
   so the nix-provided browsers match. Downloading browsers via `npx playwright
   install` on NixOS needs nix-ld and is not reproducible.
4. **fxhoudinimcp pinned to v2.25.0 (`2278840713996159333df75b8202dc3fc1c35fe2`), not
   v2.10.0.** Squatch's pin `3ab5cf27…` no longer exists in upstream history
   (rewritten); the Notion plan's `079ed58…` neither. v2.25.0 is the current
   release (2026-10-05) and its bridge wire format is what the sidecar's client
   and its contract tests are written against.
5. **MCP server registered from the extension (`pi.registerMcpServer`), no
   `.pi/mcp.json`.** The Houdini port is a runtime value (second Houdini → 8101),
   which a static file cannot express. Exposure `codemode` with a curated set of
   ~28 `direct` tools (`DIRECT_TOOLS` in `pi/extensions/houdini.ts`); 210 direct
   tools would crowd the context. The sidecar loads pi's codemode and tool-search
   extensions so the rest stays reachable.
6. **Sidecar embeds pi via the SDK (`createAgentSessionRuntime`), not `pi --mode
   rpc`.** One process, direct access to the model list, session runtime and
   extension hooks; replacement of the session on new/switch/fork is handled by
   re-subscribing in the adapter. pi pinned exactly at 1.1.0; `npm run check-pi`
   guards the surface used.
7. **pi file tools (bash/edit/write) blocked by default**, toggle in the pane.
   Implemented as a `tool_call` gate in the extension rather than `noTools`, so
   the toggle works mid-session without re-creating the session.
8. **Per-turn undo relies on Houdini nesting undo blocks by depth.** `begin_turn`
   enters a `hou.undos.group` that outlives the request; fxhoudinimcp's own
   per-command groups then nest inside it. Unverified on a real Houdini: it is the
   first item of `docs/manual-e2e.md`. Fallback if wrong: `/undo-turn` performs
   as many `scene.undo` calls as the turn issued commands.
9. **Playwright pinned to the flake's `playwright-driver` version (1.63.0, not
   the 1.61.1 first assumed).** `nix eval nixpkgs#…` answered from the registry's
   channel, the flake's `nixos-unstable` pin is newer; the devShell exports
   `PLAYWRIGHT_DRIVER_VERSION` so the mismatch is visible.
10. **Compaction's condense call is a one-shot `completeSimple` on the current
    model** (no tools, in-memory), not a second AgentSession. Cheaper and it
    cannot touch the scene.
11. **The Squatch consumer work is NOT in this run.** SquatchLinux's pi bump
    landed independently (pi is 1.1.0 on tekla now); the four `/opt/hfs22.0`
    defaults in the Squatch repo and the home-manager package-file entry are
    left for a separate PR, since this run is the houdini-pi repo.
