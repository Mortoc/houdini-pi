import type { ModelRef } from "@houdini-pi/protocol";
import { describe, expect, it } from "vitest";
import { arrangeModels, modelLabel } from "./model-list.js";

const model = (id: string, name = id): ModelRef => ({ provider: "p", id, name, reasoning: false, vision: true });
const key = (id: string) => ({ provider: "p", id });
const ALL = [model("a", "Alpha"), model("b", "Bravo"), model("c", "Charlie"), model("d", "Delta"), model("e", "Echo")];
const shape = (sections: ReturnType<typeof arrangeModels>) => sections.map((s) => [s.title ?? "selected", s.models.map((m) => m.id)]);

describe("the model picker's order", () => {
  it("puts the selected model first, then Recommended in curated order, then everything else", () => {
    expect(shape(arrangeModels(ALL, key("d"), [key("c"), key("a")], ""))).toEqual([
      ["selected", ["d"]],
      ["Recommended", ["c", "a"]],
      ["All models", ["b", "e"]],
    ]);
  });

  it("does not repeat the selected model when it is also recommended", () => {
    expect(shape(arrangeModels(ALL, key("c"), [key("c"), key("a")], ""))).toEqual([
      ["selected", ["c"]],
      ["Recommended", ["a"]],
      ["All models", ["b", "d", "e"]],
    ]);
  });

  it("narrows each section when searching, and drops the empty ones", () => {
    expect(shape(arrangeModels(ALL, key("d"), [key("c"), key("a")], "char"))).toEqual([["Recommended", ["c"]]]);
  });

  it("skips recommended models that are not available", () => {
    expect(shape(arrangeModels(ALL, undefined, [key("gone"), key("b")], ""))).toEqual([
      ["Recommended", ["b"]],
      ["All models", ["a", "c", "d", "e"]],
    ]);
  });

  it("says (Default) first on the default model only", () => {
    expect(modelLabel(model("c", "Charlie"), key("c"))).toBe("(Default) Charlie");
    expect(modelLabel(model("d", "Delta"), key("c"))).toBe("Delta");
    expect(modelLabel(model("d", "Delta"), undefined)).toBe("Delta");
  });
});
