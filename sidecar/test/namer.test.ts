import { describe, expect, it } from "vitest";
import { cleanName, namingPrompt, pickDefaultModel, pickNamingModel, shouldRename } from "../src/namer.js";

const models = [
  { provider: "a", id: "big", name: "Big", reasoning: true, vision: true, cost: { input: 10, output: 30 } },
  { provider: "a", id: "nano", name: "Nano", reasoning: false, vision: false, cost: { input: 0.1, output: 0.4 } },
  { provider: "b", id: "free", name: "Free", reasoning: false, vision: false, cost: { input: 0, output: 0 } },
  { provider: "b", id: "unpriced", name: "Unpriced", reasoning: false, vision: false },
];

describe("session naming", () => {
  it("picks the cheapest priced model, never a free or unpriced one", () => {
    expect(pickNamingModel(models, "cheapest")?.id).toBe("nano");
  });

  it("honours an explicit provider/model setting, including ids with slashes", () => {
    expect(pickNamingModel(models, "a/big")?.id).toBe("big");
    expect(pickNamingModel([{ provider: "openrouter", id: "google/gemini", name: "g", reasoning: false, vision: true }], "openrouter/google/gemini")?.id).toBe("google/gemini");
    expect(pickNamingModel(models, "a/none")).toBeUndefined();
  });

  it("picks the first available default model, in order", () => {
    expect(pickDefaultModel(models, ["x/none", "a/nano", "a/big"])?.id).toBe("nano");
    expect(pickDefaultModel(models, ["x/none"])).toBeUndefined();
    expect(pickDefaultModel([{ provider: "openrouter", id: "deepseek/deepseek-v4-flash-vision-exp", name: "d", reasoning: true, vision: true }], ["openrouter/deepseek/deepseek-v4-flash-vision-exp"])?.id).toBe("deepseek/deepseek-v4-flash-vision-exp");
  });

  it("renames only at the configured user-message counts", () => {
    expect(shouldRename(1, [1, 5])).toBe(true);
    expect(shouldRename(3, [1, 5])).toBe(false);
    expect(shouldRename(5, [1, 5])).toBe(true);
  });

  it("builds a prompt from the tail of the transcript and cleans the answer", () => {
    const prompt = namingPrompt([{ role: "user", text: "spawn an env light" }]);
    expect(prompt).toContain("at most five words");
    expect(prompt.endsWith("user: spawn an env light")).toBe(true);
    expect(cleanName('"Env Light Setup."\n')).toBe("Env Light Setup");
    expect(cleanName("\n\n  Wires  \nmore")).toBe("Wires");
  });
});
