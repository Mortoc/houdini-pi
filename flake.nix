{
  description = "houdini-pi: an in-Houdini chat agent built on pi";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
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
