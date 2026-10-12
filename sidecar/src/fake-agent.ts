import type { HistoryMessage, ModelRef, SessionRef, ThinkingLevel } from "@houdini-pi/protocol";
import type { AgentEvent, AgentLike, AgentStats } from "./agent-like.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const FAKE_MODELS: ModelRef[] = [
  { provider: "fake", id: "fake-fast", name: "Fake Fast", reasoning: false },
  { provider: "fake", id: "fake-deep", name: "Fake Deep", reasoning: true },
];

/** Canned agent for UI work and tests: every prompt streams the same turn. */
export class FakeAgent implements AgentLike {
  sessionId = "fake-session-1";
  sessionPath: string | undefined = "/fake/sessions/1.jsonl";
  model: ModelRef | undefined = FAKE_MODELS[0];
  thinkingLevel: ThinkingLevel = "medium";
  isStreaming = false;
  private listeners = new Set<(event: AgentEvent) => void>();
  private history: HistoryMessage[] = [];
  private aborted = false;
  private turns = 0;
  readonly calls: string[] = [];

  constructor(private readonly delayMs = 15) {}

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: AgentEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private async step(event: AgentEvent): Promise<boolean> {
    if (this.aborted) return false;
    this.emit(event);
    await sleep(this.delayMs);
    return !this.aborted;
  }

  async prompt(text: string): Promise<void> {
    this.calls.push(`prompt:${text}`);
    this.history.push({ role: "user", text });
    this.isStreaming = true;
    this.aborted = false;
    const reply = `I would make the wires thinner for "${text}".`;
    const run = async () => {
      this.emit({ type: "agent_start" });
      const steps: AgentEvent[] = [
        { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "Looking at the selected nodes…" } },
        { type: "tool_execution_start", toolCallId: "call-1", toolName: "mcp__fxhoudini__set_parameter", args: { node_path: "/obj/geo1/wire1", parm_name: "radius", value: 0.01 } },
        { type: "tool_execution_end", toolCallId: "call-1", toolName: "mcp__fxhoudini__set_parameter", result: { ok: true }, isError: false, durationMs: 12 },
        ...reply.split(" ").map((word): AgentEvent => ({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: `${word} ` } })),
        { type: "message_end", message: { role: "assistant", text: reply } },
        { type: "turn_end", turnIndex: this.turns++ },
      ];
      for (const event of steps) {
        if (!(await this.step(event))) break;
      }
      if (!this.aborted) this.history.push({ role: "assistant", text: reply });
      this.isStreaming = false;
      this.emit({ type: "agent_settled", aborted: this.aborted });
    };
    await run();
  }

  async steer(text: string) { this.calls.push(`steer:${text}`); }
  async followUp(text: string) { this.calls.push(`followUp:${text}`); }
  async abort() { this.calls.push("abort"); this.aborted = true; }
  async setModel(provider: string, modelId: string) {
    this.calls.push(`setModel:${provider}/${modelId}`);
    const found = FAKE_MODELS.find((m) => m.provider === provider && m.id === modelId);
    if (!found) throw new Error(`unknown model ${provider}/${modelId}`);
    this.model = found;
    this.emit({ type: "model_changed" });
  }
  setThinkingLevel(level: ThinkingLevel) { this.calls.push(`thinking:${level}`); this.thinkingLevel = level; this.emit({ type: "model_changed" }); }
  async getAvailableModels() { return FAKE_MODELS; }
  async newSession() { this.calls.push("newSession"); this.sessionId = `fake-session-${Date.now()}`; this.history = []; }
  async switchSession(sessionPath: string) { this.calls.push(`switch:${sessionPath}`); this.sessionPath = sessionPath; }
  async fork(entryId: string) { this.calls.push(`fork:${entryId}`); }
  async listSessions(): Promise<SessionRef[]> {
    return [{ id: this.sessionId, path: this.sessionPath ?? "", name: undefined, firstMessage: this.history[0]?.text ?? "", modified: Date.now() }];
  }
  async compact() { this.calls.push("compact"); }
  getHistory() { return [...this.history]; }
  getStats(): AgentStats { return { cost: 0.0042 * Math.max(1, this.turns) }; }
}
