import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionIndex } from "../src/session-index.js";

describe("SessionIndex", () => {
  it("round-trips a hip to its session file, creating the directory", () => {
    const file = join(mkdtempSync(join(tmpdir(), "houdini-pi-index-")), "nested", "sessions.json");
    const index = new SessionIndex(file);
    expect(index.get("/scenes/a.hip")).toBeUndefined();
    index.set("/scenes/a.hip", "/sessions/1.jsonl");
    index.set("/scenes/b.hip", "/sessions/2.jsonl");
    expect(new SessionIndex(file).get("/scenes/a.hip")).toBe("/sessions/1.jsonl");
    expect(new SessionIndex(file).get("/scenes/b.hip")).toBe("/sessions/2.jsonl");
  });

  it("refuses a corrupt index instead of silently starting over", () => {
    const file = join(mkdtempSync(join(tmpdir(), "houdini-pi-index-")), "sessions.json");
    writeFileSync(file, "{not json");
    expect(() => new SessionIndex(file).get("/x.hip")).toThrow(/unreadable/);
  });
});
