import { type ClientMessage, type HoudiniActionKind, type ServerMessage, decodeClient, encode, ProtocolError } from "@houdini-pi/protocol";
import type { WebSocket } from "ws";
import type { AgentEvent, AgentLike } from "./agent-like.js";
import { BridgeUnreachable } from "@houdini-pi/pi-package";
import { DEFAULT_SESSION_NAME, recommendedModels, SessionNamer } from "./namer.js";
import { DEFAULT_SETTINGS, type Settings } from "./settings.js";

/** What the hub needs from Houdini beyond the agent: memory and undo, both bridge-backed. */
export interface HoudiniPort {
  hipPath(): Promise<string | undefined>;
  /** Open a hip in Houdini. Rejects when the current scene has unsaved changes. */
  loadHip(path: string): Promise<void>;
  /** One answer-button action in Houdini. */
  action(kind: HoudiniActionKind, value: string): Promise<void>;
  memoryRead(): Promise<{ text: string; prevAvailable: boolean }>;
  memoryReplace(text: string): Promise<void>;
  memoryRollback(): Promise<void>;
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

  constructor(
    private readonly agent: AgentLike,
    private readonly houdini: HoudiniPort,
    settings: Settings = DEFAULT_SETTINGS,
    /** Called when a pane opens on a different hip than the conversation was started for. */
    private readonly onHipChanged?: (hip: string | undefined) => Promise<void>,
    /** The hip a listed session worked on, from the host's index. */
    private readonly hipOfSession: (sessionPath: string) => string | undefined = () => undefined,
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
      case "switch_session": {
        // The conversation belongs to a scene: load that hip too. Switch first,
        // so the pane that reconnects after Houdini rebuilds its desktop finds
        // the conversation already matching the hip.
        const hip = this.hipOfSession(message.sessionPath);
        const hip_differs = hip !== undefined && hip !== this.currentHip;
        await this.agent.switchSession(message.sessionPath);
        if (hip_differs) {
          this.currentHip = hip;
          await this.houdini.loadHip(hip);
        }
        await this.sendHello(socket);
        return;
      }
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
        const sessions = (await this.agent.listSessions()).map((session) => ({ ...session, hip: this.hipOfSession(session.path) }));
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
      case "houdini_action":
        await this.houdini.action(message.kind, message.value);
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

export function errorMessage(error: unknown): ServerMessage {
  const text = error instanceof Error ? error.message : String(error);
  if (error instanceof BridgeUnreachable) return { type: "error", message: text, action: "reconnect" };
  const looks_like_auth = /api key|log ?in|unauthori[sz]ed|credential/i.test(text);
  if (looks_like_auth) return { type: "error", message: text, action: "login" };
  return { type: "error", message: text };
}
