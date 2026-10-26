import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionIndex } from "../src/session-index.js";

describe("SessionIndex", () => {
  it("lists the sessions an older sidecar recorded for a hip", () => {
    const dir = mkdtempSync(join(tmpdir(), "houdini-pi-index-"));
    const file = join(dir, "sessions.json");
    writeFileSync(file, JSON.stringify({ "/sessions/1.jsonl": { hip: "/scenes/a.hip" }, "/sessions/2.jsonl": { hip: "/scenes/b.hip" }, "/sessions/3.jsonl": { hip: "/scenes/a.hip" } }));
    expect(new SessionIndex(file).sessionsOf("/scenes/a.hip")).toEqual(["/sessions/1.jsonl", "/sessions/3.jsonl"]);
    expect(new SessionIndex(join(dir, "missing.json")).sessionsOf("/scenes/a.hip")).toEqual([]);
  });

  it("ignores the old hip-hash layout and refuses a corrupt file", () => {
    const dir = mkdtempSync(join(tmpdir(), "houdini-pi-index-"));
    const old = join(dir, "old.json");
    writeFileSync(old, JSON.stringify({ abcd1234: "/sessions/1.jsonl" }));
    expect(new SessionIndex(old).sessionsOf("/sessions/1.jsonl")).toEqual([]);
    const corrupt = join(dir, "sessions.json");
    writeFileSync(corrupt, "{not json");
    expect(() => new SessionIndex(corrupt).sessionsOf("/x")).toThrow(/unreadable/);
  });
});
