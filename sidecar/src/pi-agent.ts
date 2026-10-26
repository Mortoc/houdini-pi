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
import type { Answer, HistoryMessage, HistoryTool, ModelRef, SessionRef, ThinkingLevel } from "@houdini-pi/protocol";
import type { AgentEvent, AgentLike, AgentStats } from "./agent-like.js";
import { pickDefaultModel } from "./namer.js";

export interface PiAgentOptions {
  /** The repo root: pi's project, where AGENTS.md and the pi package live. */
  cwd: string;
  /** Extension factories beyond MCP, codemode and tool search (the Houdini extension). */
  extensions: InlineExtension[];
  /** Resume this session file, else start fresh. */
  sessionPath?: string;
  /** Models for a fresh conversation, first available wins; a resumed one keeps its own. */
  defaultModel?: string[];
  onExtensionError?: (error: unknown) => void;
}

function modelRef(model: Model<any> | undefined): ModelRef | undefined {
  if (model === undefined) return undefined;
  const cost = model.cost === undefined ? {} : { cost: { input: model.cost.input, output: model.cost.output } };
  const vision = Array.isArray(model.input) && model.input.includes("image");
  return { provider: model.provider, id: model.id, name: model.name, reasoning: model.reasoning, vision, ...cost };
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
          extensionFactories: [
            createCodemodeExtension({ mode: "on" }),
            createToolSearchExtension(),
            // Only the servers our extension registers (fxhoudini): the user's
            // ~/.pi/agent/mcp.json is for their terminal pi, not the scene agent.
            createMcpExtension({ loadConfig: () => ({ servers: [], errors: [] }) }),
            ...options.extensions,
          ],
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
    runtime.setRebindSession(async (session) => {
      await agent.bind(session);
      await agent.applyDefaultModel();
    });
    await agent.bind(runtime.session);
    if (options.sessionPath === undefined) await agent.applyDefaultModel();
    return agent;
  }

  private get session(): AgentSession {
    return this.runtime.session;
  }

  /** Put a fresh conversation on the configured default model when pi can use it. */
  private async applyDefaultModel() {
    const candidates = this.options.defaultModel ?? [];
    if (candidates.length === 0) return;
    // Vision models only, the same list the picker offers, so the default it marks is this one.
    const chosen = pickDefaultModel((await this.getAvailableModels()).filter((m) => m.vision), candidates);
    if (chosen === undefined) {
      this.options.onExtensionError?.(new Error(`none of the default models is available: ${candidates.join(", ")}; using ${this.model?.id ?? "pi's default"}`));
      return;
    }
    const already = this.model?.provider === chosen.provider && this.model?.id === chosen.id;
    if (!already) await this.setModel(chosen.provider, chosen.id);
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
  get sessionName() { return this.session.sessionName; }
  setSessionName(name: string) { this.session.setSessionName(name); }

  async complete(ref: ModelRef, prompt: string): Promise<string> {
    const model = this.session.modelRuntime.getModel(ref.provider, ref.id);
    if (model === undefined) throw new Error(`unknown model ${ref.provider}/${ref.id}`);
    const reply = await this.session.modelRuntime.completeSimple(model, {
      messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
    });
    return textOf(reply.content);
  }

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
    return historyOf(this.session.messages as unknown[]);
  }

  getStats(): AgentStats {
    return { cost: this.session.getSessionStats().cost };
  }

  /** Condense project memory on the current model, tool-free. */
  async condense(prompt: string): Promise<string> {
    const current = this.model;
    if (current === undefined) throw new Error("no model selected");
    return this.complete(current, prompt);
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
    case "tool_execution_end": {
      const details = (event.result as { details?: unknown })?.details;
      const imageUrl = assetUrl(details);
      const answer = answerOf(details);
      return { type: "tool_execution_end", toolCallId: event.toolCallId, toolName: event.toolName, result: summariseResult(event.result), isError: event.isError, durationMs: event.durationMs ?? 0, ...(imageUrl ? { imageUrl } : {}), ...(answer ? { answer } : {}) };
    }
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

export function answerOf(details: unknown): Answer | undefined {
  const answer = (details as { answer?: { markdown?: unknown; invalid?: unknown } } | undefined)?.answer;
  if (answer === undefined || typeof answer.markdown !== "string") return undefined;
  return { markdown: answer.markdown, invalid: (answer.invalid as Record<string, string> | undefined) ?? {} };
}

/** The pane's URL for an image a tool stored with the conversation (`details.asset`, relative to the assets dir). */
export function assetUrl(details: unknown): string | undefined {
  const asset = (details as { asset?: unknown } | undefined)?.asset;
  if (typeof asset !== "string" || asset.length === 0) return undefined;
  return `/session-assets/${asset.split("/").map(encodeURIComponent).join("/")}`;
}

/** The transcript as the pane shows it: text plus every tool call with its result, so a reconnect loses nothing. */
export function historyOf(messages: unknown[]): HistoryMessage[] {
  const history: HistoryMessage[] = [];
  const toolsById = new Map<string, HistoryTool>();
  for (const raw of messages) {
    const message = raw as { role?: string; content?: unknown; toolCallId?: string; toolName?: string; isError?: boolean };
    if (message.role === "user") {
      const text = textOf(message.content);
      if (text.length > 0) history.push({ role: "user", text });
      continue;
    }
    if (message.role === "assistant") {
      const parts = Array.isArray(message.content) ? (message.content as { type: string; id?: string; name?: string; arguments?: unknown }[]) : [];
      const tools: HistoryTool[] = [];
      for (const part of parts) {
        if (part.type !== "toolCall" || part.id === undefined) continue;
        const tool: HistoryTool = { toolCallId: part.id, toolName: part.name ?? "?", args: part.arguments };
        tools.push(tool);
        toolsById.set(part.id, tool);
      }
      const text = textOf(message.content);
      const has_anything = text.length > 0 || tools.length > 0;
      if (has_anything) history.push({ role: "assistant", text, ...(tools.length > 0 ? { tools } : {}) });
      continue;
    }
    if (message.role === "toolResult" && message.toolCallId !== undefined) {
      const tool = toolsById.get(message.toolCallId);
      if (tool === undefined) continue;
      const summary = summariseResult({ content: message.content });
      tool.result = typeof summary === "string" ? summary : JSON.stringify(summary);
      tool.isError = message.isError ?? false;
      const imageUrl = assetUrl((message as { details?: unknown }).details);
      if (imageUrl) tool.imageUrl = imageUrl;
      const answer = answerOf((message as { details?: unknown }).details);
      if (answer) tool.answer = answer;
    }
  }
  return history;
}
