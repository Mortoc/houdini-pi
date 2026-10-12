{
  description = "houdini-pi: an in-Houdini chat agent built on pi";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAll (pkgs: rec {
        # The built plugin: houdini/ (pure Python, loaded by HOUDINI_PATH), the
        # compiled sidecar with its node_modules, and the built ui.
        houdini-pi = pkgs.buildNpmPackage {
          pname = "houdini-pi";
          version = "0.1.0";
          src = self;
          npmDepsHash = "sha256-ewuVfXp9vKmdonAnAOVFLNoaHyNERJFgbllzW4Al+08=";
          nodejs = pkgs.nodejs_22;
          npmBuildScript = "build";
          # Playwright's browser download has no business in a package build.
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -r houdini sidecar protocol pi ui node_modules package.json AGENTS.md $out/
            rm -rf $out/ui/src $out/ui/e2e
            runHook postInstall
          '';
          meta = {
            description = "In-Houdini chat agent built on pi";
            license = pkgs.lib.licenses.mit;
            mainProgram = "houdini-pi-sidecar";
          };
        };

        # The package JSON Houdini reads from $HOUDINI_USER_PREF_DIR/packages,
        # pointing at the store path above. A home-manager config installs it with
        #   home.file."houdini22.0/packages/houdini_pi.json".source = houdini-pi-package-json;
        houdini-pi-package-json = pkgs.writeText "houdini_pi.json" (builtins.toJSON {
          _houdini_pi_installer = true;
          env = [ { HOUDINI_PI_ROOT = "${houdini-pi}"; } ];
          path = "$HOUDINI_PI_ROOT/houdini";
        });

        default = houdini-pi;
      });

      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pkgs.uv
            pkgs.python312
            pkgs.playwright-driver.browsers
          ];
          # The npm @playwright/test version must equal playwright-driver's, or
          # it looks for a browser build that is not in this store path.
          PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
          PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "1";
          PLAYWRIGHT_DRIVER_VERSION = pkgs.playwright-driver.version;
        };
      });
    };
}
