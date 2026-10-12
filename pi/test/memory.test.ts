import { describe, expect, it } from "vitest";
import { appendToSection, Compactor, estimateTokens, MemoryStore, type MemoryBridge } from "../extensions/memory.js";

class FakeMemoryBridge implements MemoryBridge {
  constructor(public text = "", public prev: string | null = null) {}
  calls: string[] = [];
  async runHelper<T>(name: string, kwargs: Record<string, unknown> = {}): Promise<T> {
    this.calls.push(name);
    if (name === "memory_read") return { text: this.text, prev: this.prev } as T;
    if (name === "memory_write") {
      this.text = kwargs["text"] as string;
      this.prev = kwargs["prev"] as string | null;
      return undefined as T;
    }
    throw new Error(`unexpected helper ${name}`);
  }
}

describe("appendToSection", () => {
  it("creates the section at the end when absent", () => {
    expect(appendToSection("", "Decisions", "- use metres")).toBe("## Decisions\n\n- use metres\n");
    expect(appendToSection("# Memory\n\nintro\n", "Decisions", "- a")).toBe("# Memory\n\nintro\n\n## Decisions\n\n- a\n");
  });

  it("appends to an existing section without touching the next one", () => {
    const memory = "## Decisions\n\n- a\n\n## Conventions\n\n- snake_case\n";
    expect(appendToSection(memory, "Decisions", "- b")).toBe("## Decisions\n\n- a\n- b\n\n## Conventions\n\n- snake_case\n");
  });
});

describe("MemoryStore", () => {
  it("replace keeps the old text as prev, rollback restores it once", async () => {
    const bridge = new FakeMemoryBridge("old");
    const store = new MemoryStore(bridge);
    await store.replace("new");
    expect(bridge).toMatchObject({ text: "new", prev: "old" });
    expect(await store.prevAvailable()).toBe(true);
    await store.rollback();
    expect(bridge).toMatchObject({ text: "old", prev: null });
    await expect(store.rollback()).rejects.toThrow(/no previous memory/);
  });

  it("append writes the merged text", async () => {
    const bridge = new FakeMemoryBridge("");
    await new MemoryStore(bridge).append("Node roles", "- /obj/geo1: hero rock");
    expect(bridge.text).toBe("## Node roles\n\n- /obj/geo1: hero rock\n");
  });
});

describe("Compactor", () => {
  const big = "- decision ".repeat(200);

  it("estimates four chars per token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("does nothing under the threshold", async () => {
    const bridge = new FakeMemoryBridge("short");
    const compactor = new Compactor({ thresholdTokens: 100, condense: async () => "x" });
    expect(await compactor.maybeCompact(new MemoryStore(bridge))).toBeNull();
    expect(bridge.calls).toEqual(["memory_read"]);
  });

  it("condenses over the threshold and keeps the original as prev", async () => {
    const bridge = new FakeMemoryBridge(big);
    let seenPrompt = "";
    const compactor = new Compactor({ thresholdTokens: 100, targetTokens: 50, condense: async (prompt) => { seenPrompt = prompt; return "- decision"; } });
    const report = await compactor.maybeCompact(new MemoryStore(bridge));
    expect(report).toEqual({ before: estimateTokens(big), after: estimateTokens("- decision") });
    expect(bridge.text).toBe("- decision\n");
    expect(bridge.prev).toBe(big);
    expect(seenPrompt).toContain("under 50 tokens");
    expect(seenPrompt).toContain(big);
  });

  it("leaves memory untouched when condensing fails or does not shrink", async () => {
    const bridge = new FakeMemoryBridge(big);
    const failing = new Compactor({ thresholdTokens: 100, condense: async () => { throw new Error("provider down"); } });
    await expect(failing.maybeCompact(new MemoryStore(bridge))).rejects.toThrow("provider down");
    const growing = new Compactor({ thresholdTokens: 100, condense: async () => big + big });
    await expect(growing.maybeCompact(new MemoryStore(bridge))).rejects.toThrow(/left untouched/);
    const empty = new Compactor({ thresholdTokens: 100, condense: async () => "  " });
    await expect(empty.maybeCompact(new MemoryStore(bridge))).rejects.toThrow(/left untouched/);
    expect(bridge).toMatchObject({ text: big, prev: null });
  });
});
