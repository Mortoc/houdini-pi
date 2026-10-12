/**
 * The slice of pi's AgentSession the sidecar drives, as an interface so tests
 * run against a fake and Task 8's adapter is the only file that imports pi.
 * Event shapes mirror pi's session events field for field.
 */
import type { HistoryMessage, ModelRef, SessionRef, ThinkingLevel } from "@houdini-pi/protocol";

export type AssistantStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "text_start" | "text_end" | "thinking_start" | "thinking_end" | "toolcall_start" | "toolcall_delta" | "toolcall_end" | "start" | "done" | "error" };

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "message_update"; assistantMessageEvent: AssistantStreamEvent }
  | { type: "message_end"; message: { role: string; text: string } }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean; durationMs: number; image?: { mimeType: string; data: string } }
  | { type: "turn_end"; turnIndex: number }
  | { type: "agent_settled"; aborted: boolean }
  | { type: "model_changed" };

export interface AgentStats {
  cost: number;
}

export interface AgentLike {
  readonly sessionId: string;
  readonly sessionPath: string | undefined;
  readonly model: ModelRef | undefined;
  readonly thinkingLevel: ThinkingLevel;
  readonly isStreaming: boolean;
  readonly sessionName: string | undefined;
  setSessionName(name: string): void;
  /** One-shot, tool-free completion on `model`; used for naming and memory compaction. */
  complete(model: ModelRef, prompt: string): Promise<string>;
  /** Survives session replacement: the adapter re-subscribes on the new session. */
  subscribe(listener: (event: AgentEvent) => void): () => void;
  prompt(text: string, images?: { mimeType: string; data: string }[]): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  abort(): Promise<void>;
  setModel(provider: string, modelId: string): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): void;
  getAvailableModels(): Promise<ModelRef[]>;
  newSession(): Promise<void>;
  switchSession(sessionPath: string): Promise<void>;
  fork(entryId: string): Promise<void>;
  listSessions(): Promise<SessionRef[]>;
  compact(): Promise<void>;
  getHistory(): HistoryMessage[];
  getStats(): AgentStats;
}
