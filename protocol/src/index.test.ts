import { describe, expect, it } from "vitest";
import { type ClientMessage, type ServerMessage, decodeClient, decodeServer, encode, ProtocolError } from "./index.js";

const clientMessages: ClientMessage[] = [
  { type: "prompt", text: "hi" },
  { type: "prompt", text: "hi", images: [{ mimeType: "image/png", data: "AAAA" }] },
  { type: "steer", text: "wait" },
  { type: "follow_up", text: "then" },
  { type: "abort" },
  { type: "new_session" },
  { type: "switch_session", sessionPath: "/x.jsonl" },
  { type: "fork", entryId: "e1" },
  { type: "set_model", provider: "openrouter", modelId: "m" },
  { type: "set_thinking", level: "high" },
  { type: "compact" },
  { type: "list_models" },
  { type: "list_sessions" },
  { type: "memory_read" },
  { type: "memory_edit", text: "# memo" },
  { type: "undo_compaction" },
  { type: "rename_session", name: "Env light" },
  { type: "set_link_group", group: "3" },
  { type: "undo_turn" },
];

const serverMessages: ServerMessage[] = [
  { type: "hello", sessionId: "s", sessionPath: undefined, model: undefined, thinkingLevel: "off", hip: undefined, sessionName: undefined, isStreaming: false, linkGroup: "none" },
  { type: "state", model: undefined, thinkingLevel: "low", isStreaming: true },
  { type: "session_name", name: "Env light" },
  { type: "link_group", group: "selection" },
  { type: "user_message", text: "hi" },
  { type: "text_delta", delta: "a" },
  { type: "thinking_delta", delta: "b" },
  { type: "message_end", role: "assistant", text: "ab" },
  { type: "tool_start", toolCallId: "t1", toolName: "mcp__fxhoudini__set_parameter", args: { a: 1 } },
  { type: "tool_end", toolCallId: "t1", toolName: "x", result: "ok", isError: false, durationMs: 3 },
  { type: "tool_end", toolCallId: "t2", toolName: "inspect_cop", result: "Rendered", isError: false, durationMs: 3, imageUrl: "/session-assets/s1/t2.png" },
  { type: "turn_end", turnIndex: 0 },
  { type: "settled", aborted: false, cost: 0.01, durationMs: 1200 },
  { type: "models", models: [] },
  { type: "sessions", sessions: [{ id: "s", path: "/p.jsonl", name: undefined, firstMessage: "hi", modified: 1, hip: "/a.hip" }] },
  { type: "memory", text: "", prevAvailable: false },
  { type: "memory_compacted", before: 20000, after: 7000 },
  { type: "error", message: "boom", action: "reconnect" },
  { type: "history", messages: [{ role: "user", text: "hi" }] },
];

describe("protocol", () => {
  it.each(clientMessages)("round-trips client %j", (message) => {
    expect(decodeClient(encode(message))).toEqual(message);
  });

  it.each(serverMessages)("round-trips server %j", (message) => {
    expect(decodeServer(encode(message))).toEqual(message);
  });

  it("rejects an unknown type", () => {
    expect(() => decodeClient('{"type":"dance"}')).toThrow(ProtocolError);
    expect(() => decodeServer('{"type":"dance"}')).toThrow(/unknown server message type/);
  });

  it("rejects a message missing a required field", () => {
    expect(() => decodeClient('{"type":"prompt"}')).toThrow(/missing "text"/);
    expect(() => decodeServer('{"type":"tool_end","toolCallId":"1"}')).toThrow(/missing "toolName"/);
  });

  it("rejects non-JSON and non-objects", () => {
    expect(() => decodeClient("nope")).toThrow(/not JSON/);
    expect(() => decodeClient("[1]")).toThrow(/not an object/);
  });
});
