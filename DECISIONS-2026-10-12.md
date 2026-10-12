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
