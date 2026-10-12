import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionIndex } from "../src/session-index.js";

describe("SessionIndex", () => {
  it("tags a session with its hip, creating the directory", () => {
    const file = join(mkdtempSync(join(tmpdir(), "houdini-pi-index-")), "nested", "sessions.json");
    const index = new SessionIndex(file);
    expect(index.hipOf("/sessions/1.jsonl")).toBeUndefined();
    index.tag("/sessions/1.jsonl", "/scenes/a.hip");
    index.tag("/sessions/2.jsonl", "/scenes/b.hip");
    expect(new SessionIndex(file).hipOf("/sessions/1.jsonl")).toBe("/scenes/a.hip");
    expect(new SessionIndex(file).hipOf("/sessions/2.jsonl")).toBe("/scenes/b.hip");
  });

  it("ignores the old hip-hash layout and refuses a corrupt file", () => {
    const dir = mkdtempSync(join(tmpdir(), "houdini-pi-index-"));
    const old = join(dir, "old.json");
    writeFileSync(old, JSON.stringify({ abcd1234: "/sessions/1.jsonl" }));
    expect(new SessionIndex(old).hipOf("/sessions/1.jsonl")).toBeUndefined();
    const corrupt = join(dir, "sessions.json");
    writeFileSync(corrupt, "{not json");
    expect(() => new SessionIndex(corrupt).hipOf("/x")).toThrow(/unreadable/);
  });
});
