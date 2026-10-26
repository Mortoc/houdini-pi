import { type ClientMessage, type HoudiniActionKind, type ServerMessage, decodeClient, encode, ProtocolError } from "@houdini-pi/protocol";
import type { WebSocket } from "ws";
import type { AgentEvent, AgentLike } from "./agent-like.js";
import { BridgeUnreachable } from "@houdini-pi/pi-package";
import { DEFAULT_SESSION_NAME, recommendedModels, SessionNamer } from "./namer.js";
import { openExternal } from "./open-external.js";
import { DEFAULT_SETTINGS, type Settings } from "./settings.js";

/** What the hub needs from Houdini beyond the agent: memory and undo, both bridge-backed. */
export interface HoudiniPort {
  hipPath(): Promise<string | undefined>;
  /** The session files this hip has had conversations in, kept inside the hip so Save As carries them. */
  hipSessions(): Promise<string[]>;
  /** Record a conversation on the current hip. */
  tagSession(sessionPath: string): Promise<void>;
  /** One answer-button action in Houdini. */
  action(kind: HoudiniActionKind, value: string): Promise<void>;
  memoryRead(): Promise<{ text: string; prevAvailable: boolean }>;
  memoryReplace(text: string): Promise<void>;
  memoryRollback(): Promise<void>;
  projectMemoryRead(): Promise<{ available: boolean; text: string; prevAvailable: boolean }>;
  projectMemoryReplace(text: string): Promise<void>;
  undoTurn(): Promise<void>;
}

export interface SocketLike {
  send(data: string): void;
  on(event: "message", listener: (data: unknown) => void): unknown;
  on(event: "close", listener: () => void): unknown;
}

/** One agent, many panes: every attached socket sees the same stream. */
export class SessionHub {
  private sockets = new Set<SocketLike>();
  private promptStartedAt: number | undefined;
  private readonly namer: SessionNamer;
  private readonly defaultModelCandidates: string[];

  private currentHip: string | undefined | null = null;

  /** Update the cached hip without firing onHipChanged. For Save As: the pane
   *  stays connected, so the reconnect path never runs, but the hip path changed. */
  setHip(hip: string | undefined): void {
    this.currentHip = hip;
  }

  constructor(
    private readonly agent: AgentLike,
    private readonly houdini: HoudiniPort,
    settings: Settings = DEFAULT_SETTINGS,
    /** Called when a pane opens on a different hip than the conversation was started for. */
    private readonly onHipChanged?: (hip: string | undefined) => Promise<void>,
    /** Sessions recorded for a hip before the list lived in the hip (the old ~/.houdini-pi/sessions.json). */
    private readonly legacySessionsOf: (hip: string) => string[] = () => [],
  ) {
    this.namer = new SessionNamer(agent, settings.naming);
    this.defaultModelCandidates = settings.defaultModel;
    agent.subscribe((event) => this.onAgentEvent(event));
  }

  attach(socket: SocketLike | WebSocket) {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("message", (data) => void this.onClientMessage(socket, String(data)));
    void this.sendHello(socket);
  }

  private async sendHello(socket: SocketLike) {
    let hip: string | undefined;
    try {
      hip = await this.houdini.hipPath();
    } catch (error) {
      this.sendTo(socket, errorMessage(error));
    }
    // Houdini rebuilds the desktop on File ▸ Open, so the pane reconnects on a
    // new hip while the sidecar keeps running: switch conversations to match.
    const hip_changed = this.currentHip !== null && this.currentHip !== hip;
    this.currentHip = hip;
    if (hip_changed && this.onHipChanged !== undefined) {
      try {
        await this.onHipChanged(hip);
      } catch (error) {
        this.sendTo(socket, errorMessage(error));
      }
    }
    this.sendTo(socket, {
      type: "hello",
      sessionId: this.agent.sessionId,
      sessionPath: this.agent.sessionPath,
      model: this.agent.model,
      thinkingLevel: this.agent.thinkingLevel,
      hip,
      sessionName: this.agent.sessionName ?? DEFAULT_SESSION_NAME,
      isStreaming: this.agent.isStreaming,
      cost: this.agent.getStats().cost,
    });
    this.sendTo(socket, { type: "history", messages: this.agent.getHistory() });
  }

  /** The picker's list. The agent has to look at renders, so text-only models are not offered. */
  private async modelsMessage(): Promise<ServerMessage> {
    const models = (await this.agent.getAvailableModels()).filter((m) => m.vision);
    const recommended = recommendedModels(models, this.defaultModelCandidates).map(({ provider, id }) => ({ provider, id }));
    const [defaultModel] = recommended;
    return { type: "models", models, recommended, ...(defaultModel ? { defaultModel } : {}) };
  }

  private state(): ServerMessage {
    return { type: "state", model: this.agent.model, thinkingLevel: this.agent.thinkingLevel, isStreaming: this.agent.isStreaming };
  }

  broadcast(message: ServerMessage) {
    const raw = encode(message);
    for (const socket of this.sockets) socket.send(raw);
  }

  private sendTo(socket: SocketLike, message: ServerMessage) {
    socket.send(encode(message));
  }

  private onAgentEvent(event: AgentEvent) {
    switch (event.type) {
      case "agent_start":
        this.broadcast(this.state());
        return;
      case "message_update": {
        const stream = event.assistantMessageEvent;
        if (stream.type === "text_delta") this.broadcast({ type: "text_delta", delta: stream.delta });
        if (stream.type === "thinking_delta") this.broadcast({ type: "thinking_delta", delta: stream.delta });
        return;
      }
      case "message_end":
        if (event.message.role === "assistant") this.broadcast({ type: "message_end", role: "assistant", text: event.message.text });
        return;
      case "tool_execution_start":
        this.broadcast({ type: "tool_start", toolCallId: event.toolCallId, toolName: event.toolName, args: event.args });
        return;
      case "tool_execution_end":
        this.broadcast({
          type: "tool_end",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: typeof event.result === "string" ? event.result : JSON.stringify(event.result),
          isError: event.isError,
          durationMs: event.durationMs,
          ...(event.imageUrl ? { imageUrl: event.imageUrl } : {}),
          ...(event.answer ? { answer: event.answer } : {}),
        });
        return;
      case "turn_end":
        this.broadcast({ type: "turn_end", turnIndex: event.turnIndex });
        return;
      case "agent_settled": {
        const durationMs = this.promptStartedAt === undefined ? 0 : Date.now() - this.promptStartedAt;
        this.promptStartedAt = undefined;
        this.broadcast({ type: "settled", aborted: event.aborted, cost: this.agent.getStats().cost, durationMs });
        void this.remember();
        this.broadcast(this.state());
        if (!event.aborted) {
          this.namer
            .maybeRename()
            .then((name) => {
              if (name !== undefined) this.broadcast({ type: "session_name", name });
            })
            .catch((error) => this.broadcast({ type: "error", message: `could not name the session: ${(error as Error).message}` }));
        }
        return;
      }
      case "model_changed":
        this.broadcast(this.state());
        return;
    }
  }

  /** After every turn: record the conversation on the hip, and pick up a Save As
   *  (the path changes without a reconnect) so the next reconnect does not
   *  mistake it for a different scene. */
  private async remember() {
    try {
      const hip = await this.houdini.hipPath();
      if (hip !== undefined) this.currentHip = hip;
      if (this.agent.sessionPath !== undefined) await this.houdini.tagSession(this.agent.sessionPath);
    } catch (error) {
      this.broadcast({ type: "error", message: `could not record this conversation on the hip: ${(error as Error).message}` });
    }
  }

  private async onClientMessage(socket: SocketLike, raw: string) {
    let message: ClientMessage;
    try {
      message = decodeClient(raw);
    } catch (error) {
      this.sendTo(socket, { type: "error", message: (error as ProtocolError).message });
      return;
    }
    try {
      await this.handle(socket, message);
    } catch (error) {
      this.sendTo(socket, errorMessage(error));
    }
  }

  private async handle(socket: SocketLike, message: ClientMessage): Promise<void> {
    switch (message.type) {
      case "prompt":
        this.broadcast({ type: "user_message", text: message.text });
        this.promptStartedAt = Date.now();
        // Not awaited: the run streams back as events; awaiting would block
        // abort and steer for the whole turn.
        this.agent.prompt(message.text, message.images).catch((error) => this.broadcast(errorMessage(error)));
        return;
      case "steer":
        await this.agent.steer(message.text);
        return;
      case "follow_up":
        await this.agent.followUp(message.text);
        return;
      case "abort":
        await this.agent.abort();
        return;
      case "new_session":
        await this.agent.newSession();
        await this.sendHello(socket);
        return;
      case "switch_session":
        // Only this hip's conversations are listed, so switching never changes the scene.
        await this.agent.switchSession(message.sessionPath);
        await this.sendHello(socket);
        return;
      case "fork":
        await this.agent.fork(message.entryId);
        await this.sendHello(socket);
        return;
      case "set_model":
        await this.agent.setModel(message.provider, message.modelId);
        this.broadcast(this.state());
        return;
      case "set_thinking":
        this.agent.setThinkingLevel(message.level);
        this.broadcast(this.state());
        return;
      case "compact":
        await this.agent.compact();
        return;
      case "list_models":
        this.sendTo(socket, await this.modelsMessage());
        return;
      case "list_sessions": {
        const hip = await this.houdini.hipPath();
        const ours = new Set([...(await this.houdini.hipSessions()), ...(hip === undefined ? [] : this.legacySessionsOf(hip))]);
        const sessions = (await this.agent.listSessions()).filter((session) => ours.has(session.path));
        this.sendTo(socket, { type: "sessions", sessions });
        return;
      }
      case "memory_read":
        this.sendTo(socket, { type: "memory", ...(await this.houdini.memoryRead()) });
        return;
      case "memory_edit":
        await this.houdini.memoryReplace(message.text);
        this.broadcast({ type: "memory", ...(await this.houdini.memoryRead()) });
        return;
      case "undo_compaction":
        await this.houdini.memoryRollback();
        this.broadcast({ type: "memory", ...(await this.houdini.memoryRead()) });
        return;
      case "project_memory_read":
        this.sendTo(socket, { type: "project_memory", ...(await this.houdini.projectMemoryRead()) });
        return;
      case "project_memory_edit":
        await this.houdini.projectMemoryReplace(message.text);
        this.broadcast({ type: "project_memory", ...(await this.houdini.projectMemoryRead()) });
        return;
      case "houdini_action":
        await this.houdini.action(message.kind, message.value);
        return;
      case "open_external":
        openExternal(message.url);
        return;
      case "rename_session":
        this.agent.setSessionName(message.name);
        this.broadcast({ type: "session_name", name: message.name });
        return;
      case "undo_turn":
        await this.houdini.undoTurn();
        return;
    }
  }
}

/** File ▸ Open: keep the conversation only if the opened hip has had it, else start a fresh one. */
export async function followHip(agent: AgentLike, houdini: Pick<HoudiniPort, "hipSessions">): Promise<void> {
  const belongs = agent.sessionPath !== undefined && (await houdini.hipSessions()).includes(agent.sessionPath);
  if (!belongs) await agent.newSession();
}

export function errorMessage(error: unknown): ServerMessage {
  const text = error instanceof Error ? error.message : String(error);
  if (error instanceof BridgeUnreachable) return { type: "error", message: text, action: "reconnect" };
  const looks_like_auth = /api key|log ?in|unauthori[sz]ed|credential/i.test(text);
  if (looks_like_auth) return { type: "error", message: text, action: "login" };
  return { type: "error", message: text };
}
