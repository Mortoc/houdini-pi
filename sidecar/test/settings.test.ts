import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings } from "../src/settings.js";

describe("settings", () => {
  it("defaults when the file is absent and merges a partial file", () => {
    const dir = mkdtempSync(join(tmpdir(), "houdini-pi-settings-"));
    expect(loadSettings(join(dir, "none.json"))).toEqual(DEFAULT_SETTINGS);
    const file = join(dir, "settings.json");
    writeFileSync(file, JSON.stringify({ naming: { model: "openrouter/x/y" } }));
    expect(loadSettings(file)).toEqual({ naming: { model: "openrouter/x/y", renameAtUserMessages: [1, 5] }, followNodes: true });
    writeFileSync(file, JSON.stringify({ followNodes: false }));
    expect(loadSettings(file).followNodes).toBe(false);
  });

  it("refuses a corrupt file", () => {
    const dir = mkdtempSync(join(tmpdir(), "houdini-pi-settings-"));
    const file = join(dir, "settings.json");
    writeFileSync(file, "{nope");
    expect(() => loadSettings(file)).toThrow(/not valid JSON/);
  });
});
