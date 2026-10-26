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

describe("conversation cost", () => {
  const hello = (cost: number): ServerMessage => ({ type: "hello", sessionId: "s", sessionPath: "/s.jsonl", model: undefined, thinkingLevel: "off", hip: undefined, sessionName: undefined, isStreaming: false, cost });

  it("starts from what the conversation had already cost", () => {
    expect(play([hello(0.25)]).cost).toBe(0.25);
  });

  it("keeps the running total and gives the turn footer only that turn's share", () => {
    const state = play([hello(0.25), { type: "user_message", text: "a" }, { type: "settled", aborted: false, cost: 0.3, durationMs: 1 }]);
    expect(state.cost).toBe(0.3);
    expect(state.lastTurn?.cost).toBeCloseTo(0.05);
    const next = play([{ type: "user_message", text: "b" }, { type: "settled", aborted: false, cost: 0.31, durationMs: 1 }], state);
    expect(next.cost).toBe(0.31);
    expect(next.lastTurn?.cost).toBeCloseTo(0.01);
  });

  it("resets with the conversation", () => {
    const state = play([hello(0.25), { type: "settled", aborted: false, cost: 0.3, durationMs: 1 }, hello(0)]);
    expect(state.cost).toBe(0);
    expect(state.lastTurn).toBeUndefined();
  });
});
