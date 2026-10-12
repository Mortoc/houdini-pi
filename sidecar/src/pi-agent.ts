/**
 * The one file that talks to pi's SDK. Everything else sees `AgentLike`.
 *
 * pi replaces the AgentSession object on new/switch/fork, so this adapter
 * owns an AgentSessionRuntime and re-subscribes on every replacement; hub
 * listeners never notice.
 */
import {
  type AgentSession,
  type AgentSessionEvent,
  AgentSessionRuntime,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  getAgentDir,
  type InlineExtension,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { HistoryMessage, ModelRef, SessionRef, ThinkingLevel } from "@houdini-pi/protocol";
import type { AgentEvent, AgentLike, AgentStats } from "./agent-like.js";

export interface PiAgentOptions {
  /** The repo root: pi's project, where AGENTS.md and the pi package live. */
  cwd: string;
  /** Extension factories beyond MCP, codemode and tool search (the Houdini extension). */
  extensions: InlineExtension[];
  /** Resume this session file, else start fresh. */
  sessionPath?: string;
  onExtensionError?: (error: unknown) => void;
}

function modelRef(model: Model<any> | undefined): ModelRef | undefined {
  if (model === undefined) return undefined;
  return { provider: model.provider, id: model.id, name: model.name, reasoning: model.reasoning };
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } => typeof part === "object" && part !== null && (part as { type?: string }).type === "text")
    .map((part) => part.text)
    .join("");
}

export class PiAgent implements AgentLike {
  private listeners = new Set<(event: AgentEvent) => void>();
  private unsubscribe: (() => void) | undefined;
  private turnIndex = 0;

  private constructor(private readonly runtime: AgentSessionRuntime, private readonly options: PiAgentOptions) {}

  static async create(options: PiAgentOptions): Promise<PiAgent> {
    const agentDir = getAgentDir();
    const factory = async ({ cwd, sessionManager, sessionStartEvent }: { cwd: string; sessionManager: SessionManager; sessionStartEvent?: unknown }) => {
      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        resourceLoaderOptions: {
          extensionFactories: [createCodemodeExtension({ mode: "on" }), createToolSearchExtension(), createMcpExtension(), ...options.extensions],
        },
      });
      const created = await createAgentSessionFromServices({
        services,
        sessionManager,
        ...(sessionStartEvent === undefined ? {} : { sessionStartEvent: sessionStartEvent as never }),
        // The agent works on the scene. File tools stay registered but off;
        // the Houdini extension's tool_call gate decides per turn.
        noTools: "builtin",
      });
      return { ...created, services, diagnostics: services.diagnostics };
    };
    const sessionManager = options.sessionPath === undefined ? SessionManager.create(options.cwd) : SessionManager.open(options.sessionPath);
    const runtime = await createAgentSessionRuntime(factory, { cwd: options.cwd, agentDir, sessionManager });
    const agent = new PiAgent(runtime, options);
    runtime.setRebindSession(async (session) => agent.bind(session));
    await agent.bind(runtime.session);
    return agent;
  }

  private get session(): AgentSession {
    return this.runtime.session;
  }

  private async bind(session: AgentSession) {
    this.unsubscribe?.();
    await session.bindExtensions({ mode: "rpc", onError: (error: unknown) => this.options.onExtensionError?.(error) } as never);
    this.unsubscribe = session.subscribe((event) => this.forward(event));
  }

  private forward(event: AgentSessionEvent) {
    if (event.type === "agent_start") this.turnIndex = 0;
    const mapped = mapEvent(event, event.type === "turn_end" ? this.turnIndex++ : 0);
    if (mapped === undefined) return;
    for (const listener of this.listeners) listener(mapped);
  }

  private emit(event: AgentEvent) {
    for (const listener of this.listeners) listener(event);
  }

  get sessionId() { return this.session.sessionId; }
  get sessionPath() { return this.session.sessionFile; }
  get model() { return modelRef(this.session.model); }
  get thinkingLevel() { return this.session.thinkingLevel as ThinkingLevel; }
  get isStreaming() { return this.session.isStreaming; }

  subscribe(listener: (event: AgentEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async prompt(text: string, images?: { mimeType: string; data: string }[]) {
    await this.session.prompt(text, images === undefined ? undefined : { images: images.map((i) => ({ type: "image" as const, ...i })) });
  }
  async steer(text: string) { await this.session.steer(text); }
  async followUp(text: string) { await this.session.followUp(text); }
  async abort() { await this.session.abort(); }

  async setModel(provider: string, modelId: string) {
    const model = this.session.modelRuntime.getModel(provider, modelId);
    if (model === undefined) throw new Error(`unknown model ${provider}/${modelId}`);
    await this.session.setModel(model);
    this.emit({ type: "model_changed" });
  }

  setThinkingLevel(level: ThinkingLevel) {
    this.session.setThinkingLevel(level);
    this.emit({ type: "model_changed" });
  }

  async getAvailableModels(): Promise<ModelRef[]> {
    const models = await this.session.modelRuntime.getAvailable();
    return models.map((m) => modelRef(m)!).sort((a, b) => `${a.provider}/${a.name}`.localeCompare(`${b.provider}/${b.name}`));
  }

  async newSession() { await this.runtime.newSession(); }
  async switchSession(sessionPath: string) { await this.runtime.switchSession(sessionPath); }
  async fork(entryId: string) { await this.runtime.fork(entryId); }

  async listSessions(): Promise<SessionRef[]> {
    const infos = await SessionManager.list(this.options.cwd);
    return infos.map((info) => ({ id: info.id, path: info.path, name: info.name, firstMessage: info.firstMessage, modified: info.modified.getTime() }));
  }

  async compact() { await this.session.compact(); }

  getHistory(): HistoryMessage[] {
    const history: HistoryMessage[] = [];
    for (const message of this.session.messages) {
      const is_chat = message.role === "user" || message.role === "assistant";
      if (!is_chat) continue;
      const text = textOf((message as { content: unknown }).content);
      if (text.length > 0) history.push({ role: message.role as "user" | "assistant", text });
    }
    return history;
  }

  getStats(): AgentStats {
    return { cost: this.session.getSessionStats().cost };
  }

  /** One-shot, tool-free completion on the current model; used to condense project memory. */
  async condense(prompt: string): Promise<string> {
    const model = this.session.model;
    if (model === undefined) throw new Error("no model selected");
    const reply = await this.session.modelRuntime.completeSimple(model, {
      messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
    });
    return textOf(reply.content);
  }

  async dispose() {
    this.unsubscribe?.();
    await this.runtime.dispose();
  }
}

export function mapEvent(event: AgentSessionEvent, turnIndex: number): AgentEvent | undefined {
  switch (event.type) {
    case "agent_start":
      return { type: "agent_start" };
    case "message_update": {
      const stream = event.assistantMessageEvent;
      if (stream.type === "text_delta" || stream.type === "thinking_delta") return { type: "message_update", assistantMessageEvent: { type: stream.type, delta: stream.delta } };
      return undefined;
    }
    case "message_end":
      return { type: "message_end", message: { role: event.message.role, text: textOf((event.message as { content: unknown }).content) } };
    case "tool_execution_start":
      return { type: "tool_execution_start", toolCallId: event.toolCallId, toolName: event.toolName, args: event.args };
    case "tool_execution_end":
      return { type: "tool_execution_end", toolCallId: event.toolCallId, toolName: event.toolName, result: summariseResult(event.result), isError: event.isError, durationMs: event.durationMs ?? 0 };
    case "turn_end":
      return { type: "turn_end", turnIndex };
    case "agent_settled":
      return { type: "agent_settled", aborted: event.aborted };
    default:
      return undefined;
  }
}

function summariseResult(result: unknown): unknown {
  const content = (result as { content?: unknown })?.content;
  const text = textOf(content);
  return text.length > 0 ? text : result;
}
