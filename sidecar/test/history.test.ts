import { describe, expect, it } from "vitest";
import { historyOf } from "../src/pi-agent.js";

describe("historyOf", () => {
  it("keeps tool calls with their results, errors and images next to the assistant text", () => {
    const messages = [
      { role: "user", content: "thin wires", timestamp: 1 },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "hmm" },
          { type: "toolCall", id: "c1", name: "mcp__fxhoudini__set_parameter", arguments: { node_path: "/obj/w" } },
          { type: "toolCall", id: "c2", name: "inspect_cop", arguments: { node_path: "/obj/c/out" } },
          { type: "text", text: "" },
        ],
      },
      { role: "toolResult", toolCallId: "c1", toolName: "mcp__fxhoudini__set_parameter", content: [{ type: "text", text: "Traceback: nope" }], isError: true },
      { role: "toolResult", toolCallId: "c2", toolName: "inspect_cop", content: [{ type: "image", data: "AAAA", mimeType: "image/png" }, { type: "text", text: "Rendered" }], isError: false, details: { asset: "s1/c2.png", node: "/obj/c/out" } },
      { role: "assistant", content: [{ type: "text", text: "fixed" }] },
      { role: "custom", customType: "houdini-pi-context", content: "scene", display: false },
    ];
    expect(historyOf(messages)).toEqual([
      { role: "user", text: "thin wires" },
      {
        role: "assistant",
        text: "",
        tools: [
          { toolCallId: "c1", toolName: "mcp__fxhoudini__set_parameter", args: { node_path: "/obj/w" }, result: "Traceback: nope", isError: true },
          { toolCallId: "c2", toolName: "inspect_cop", args: { node_path: "/obj/c/out" }, result: "Rendered", isError: false, imageUrl: "/session-assets/s1/c2.png" },
        ],
      },
      { role: "assistant", text: "fixed" },
    ]);
  });
});
