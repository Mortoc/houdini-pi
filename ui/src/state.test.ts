import type { ServerMessage } from "@houdini-pi/protocol";
import { describe, expect, it } from "vitest";
import { initialState, reduce, type PaneState } from "./state.js";

const play = (messages: ServerMessage[], from: PaneState = initialState) => messages.reduce(reduce, from);

const failingTurn = (text: string): ServerMessage[] => [
  { type: "user_message", text },
  { type: "tool_start", toolCallId: `${text}-a`, toolName: "inspect_viewport", args: {} },
  { type: "tool_end", toolCallId: `${text}-a`, toolName: "inspect_viewport", result: "boom", isError: true, durationMs: 1 },
  { type: "tool_start", toolCallId: `${text}-b`, toolName: "inspect_viewport", args: {} },
  { type: "tool_end", toolCallId: `${text}-b`, toolName: "inspect_viewport", result: "boom", isError: true, durationMs: 1 },
];

const workingTurn = (text: string): ServerMessage[] => [
  { type: "user_message", text },
  { type: "tool_start", toolCallId: `${text}-ok`, toolName: "get_node_info", args: {} },
  { type: "tool_end", toolCallId: `${text}-ok`, toolName: "get_node_info", result: "{}", isError: false, durationMs: 1 },
  { type: "settled", aborted: false, cost: 0, durationMs: 10 },
];

describe("the turn footer", () => {
  it("goes away as soon as the next message is sent", () => {
    const afterFirst = play([...failingTurn("one"), { type: "settled", aborted: false, cost: 0, durationMs: 10 }]);
    expect(afterFirst.lastTurn?.errors).toBe(2);
    expect(reduce(afterFirst, { type: "user_message", text: "two" }).lastTurn).toBeUndefined();
  });

  it("counts only this turn's tool errors when the previous turn never settled", () => {
    // The bridge died mid-turn, so no `settled` arrived and the first turn's entry stayed open.
    const state = play([...failingTurn("one"), ...workingTurn("two")]);
    expect(state.lastTurn?.errors).toBe(0);
    expect(state.entries.filter((e) => e.kind === "assistant" && e.streaming)).toEqual([]);
  });

  it("still reports a turn's own errors", () => {
    const state = play([...workingTurn("one"), ...failingTurn("two"), { type: "settled", aborted: false, cost: 0, durationMs: 10 }]);
    expect(state.lastTurn?.errors).toBe(2);
  });
});
