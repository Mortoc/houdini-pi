import type { HistoryMessage, HistoryTool, ModelRef, SessionRef, ThinkingLevel } from "@houdini-pi/protocol";
import type { AgentEvent, AgentLike, AgentStats } from "./agent-like.js";

/** A 1×1 orange PNG. */
export const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const FAKE_MODELS: ModelRef[] = [
  { provider: "fake", id: "fake-fast", name: "Fake Fast", reasoning: false, vision: true },
  { provider: "fake", id: "fake-deep", name: "Fake Deep", reasoning: true, vision: true },
  { provider: "fake", id: "fake-nano", name: "Fake Nano", reasoning: false, vision: false, cost: { input: 0.01, output: 0.02 } },
];

/** Canned agent for UI work and tests: every prompt streams the same turn. */
export class FakeAgent implements AgentLike {
  sessionId = "fake-session-1";
  sessionPath: string | undefined = "/fake/sessions/1.jsonl";
  model: ModelRef | undefined = FAKE_MODELS[0];
  thinkingLevel: ThinkingLevel = "medium";
  isStreaming = false;
  sessionName: string | undefined = undefined;
  private listeners = new Set<(event: AgentEvent) => void>();
  private history: HistoryMessage[] = [];
  private aborted = false;
  private turns = 0;
  readonly calls: string[] = [];

  constructor(private readonly delayMs = 40) {}

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
    const is_question = /^(how|what|why)\b|\?\s*$/i.test(text.trim());
    const reply = is_question ? "Here is how." : `I would make the wires thinner for "${text}".`;
    const answer = "1. Select [the wire](houdini://select?path=/obj/geo1/wire1).\n2. Open its [radius](houdini://parm?path=/obj/geo1/wire1/radius) and set it to 0.01.\n3. If it is gone, see [polyextrude help](houdini://help?page=/nodes/sop/polyextrude). Missing: [ghost](houdini://select?path=/obj/nope).";
    const run = async () => {
      this.emit({ type: "agent_start" });
      const steps: AgentEvent[] = is_question ? [
        { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "Figuring out the steps…" } },
        { type: "tool_execution_start", toolCallId: "ans-1", toolName: "present_answer", args: { markdown: answer } },
        { type: "tool_execution_end", toolCallId: "ans-1", toolName: "present_answer", result: "Answer shown.", isError: false, durationMs: 5, answer: { markdown: answer, invalid: { "houdini://select?path=/obj/nope": "nothing at /obj/nope" } } },
        { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Let me know if the wire is not where I think it is, I can also " } },
        { type: "message_end", message: { role: "assistant", text: reply } },
        { type: "turn_end", turnIndex: this.turns++ },
      ] : [
        { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "Looking at the selected nodes…" } },
        { type: "tool_execution_start", toolCallId: "call-1", toolName: "mcp__fxhoudini__set_parameter", args: { node_path: "/obj/geo1/wire1", parm_name: "radius", value: 0.01 } },
        { type: "tool_execution_end", toolCallId: "call-1", toolName: "mcp__fxhoudini__set_parameter", result: { ok: true }, isError: false, durationMs: 12 },
        { type: "tool_execution_start", toolCallId: "call-2", toolName: "mcp__fxhoudini__execute_python", args: { code: "import hou\n# thin every wire\nfor node in hou.node('/obj/geo1').children():\n    if node.type().name() == 'wire':\n        node.parm('radius').set(0.01)\nprint('done')" } },
        { type: "tool_execution_end", toolCallId: "call-2", toolName: "mcp__fxhoudini__execute_python", result: JSON.stringify({ success: true, executed: true, return_value: null, stdout: "done" }), isError: false, durationMs: 40 },
        { type: "tool_execution_start", toolCallId: "call-2b", toolName: "mcp__fxhoudini__execute_python", args: { code: "hou.node('/obj/nope').destroy()" } },
        { type: "tool_execution_end", toolCallId: "call-2b", toolName: "mcp__fxhoudini__execute_python", result: JSON.stringify({ success: false, executed: false, error: "Traceback (most recent call last):\n  File \"<string>\", line 1, in <module>\nAttributeError: 'NoneType' object has no attribute 'destroy'\n" }), isError: true, durationMs: 9 },
        { type: "tool_execution_start", toolCallId: "call-3", toolName: "inspect_cop", args: { node_path: "/obj/hex_copnet/color_out" } },
        { type: "tool_execution_end", toolCallId: "call-3", toolName: "inspect_cop", result: "Rendered /obj/hex_copnet/color_out", isError: false, durationMs: 300, imageUrl: `data:image/png;base64,${TINY_PNG}` },
        ...reply.split(" ").map((word): AgentEvent => ({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: `${word} ` } })),
        { type: "message_end", message: { role: "assistant", text: reply } },
        { type: "turn_end", turnIndex: this.turns++ },
      ];
      const tools: HistoryTool[] = [];
      for (const event of steps) {
        if (!(await this.step(event))) break;
        if (event.type === "tool_execution_start") tools.push({ toolCallId: event.toolCallId, toolName: event.toolName, args: event.args });
        if (event.type === "tool_execution_end") {
          const tool = tools.find((t) => t.toolCallId === event.toolCallId);
          if (tool) Object.assign(tool, { result: typeof event.result === "string" ? event.result : JSON.stringify(event.result), isError: event.isError, ...(event.imageUrl ? { imageUrl: event.imageUrl } : {}), ...(event.answer ? { answer: event.answer } : {}) });
        }
      }
      if (!this.aborted) this.history.push({ role: "assistant", text: reply, tools });
      this.isStreaming = false;
      this.emit({ type: "agent_settled", aborted: this.aborted });
    };
    await run();
  }

  setSessionName(name: string) { this.calls.push(`name:${name}`); this.sessionName = name; }
  async complete(model: ModelRef, prompt: string) { this.calls.push(`complete:${model.id}`); return `Named: ${prompt.split("\n").at(-1)?.slice(0, 24) ?? ""}`; }
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
  async newSession() { this.calls.push("newSession"); this.sessionId = `fake-session-${Date.now()}`; this.history = []; this.sessionName = undefined; this.turns = 0; }
  async switchSession(sessionPath: string) { this.calls.push(`switch:${sessionPath}`); this.sessionPath = sessionPath; }
  async fork(entryId: string) { this.calls.push(`fork:${entryId}`); }
  async listSessions(): Promise<SessionRef[]> {
    return [{ id: this.sessionId, path: this.sessionPath ?? "", name: this.sessionName, firstMessage: this.history[0]?.text ?? "", modified: Date.now(), hip: undefined }];
  }
  async compact() { this.calls.push("compact"); }
  getHistory() { return [...this.history]; }
  getStats(): AgentStats { return { cost: 0.0042 * Math.max(1, this.turns) }; }
}
