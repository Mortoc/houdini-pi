/**
 * WebSocket protocol between the houdini-pi sidecar and the pane UI.
 *
 * Both ends import this module, so a message shape cannot drift between them.
 * Decoders throw on anything they do not recognise: an unknown message is a
 * bug on the sending side, never something to ignore.
 */

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelRef {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  /** Accepts image input. The pane only offers these: the agent must be able to look at renders. */
  vision: boolean;
  /** USD per million tokens, when the provider publishes it. */
  cost?: { input: number; output: number };
}

export interface SessionRef {
  id: string;
  path: string;
  name: string | undefined;
  firstMessage: string;
  modified: number;
  /** The hip the conversation worked on; loading the session loads it. */
  hip: string | undefined;
}

/** Houdini's Link Pane Tab choices: "none" (Pinned), "1".."9", or "selection" (Last Selected Node). */
export type LinkGroup = "none" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "selection";

export interface ImageAttachment {
  mimeType: string;
  data: string;
}

export type ClientMessage =
  | { type: "prompt"; text: string; images?: ImageAttachment[] }
  | { type: "steer"; text: string }
  | { type: "follow_up"; text: string }
  | { type: "abort" }
  | { type: "new_session" }
  | { type: "switch_session"; sessionPath: string }
  | { type: "fork"; entryId: string }
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "set_thinking"; level: ThinkingLevel }
  | { type: "compact" }
  | { type: "list_models" }
  | { type: "list_sessions" }
  | { type: "memory_read" }
  | { type: "memory_edit"; text: string }
  | { type: "undo_compaction" }
  | { type: "rename_session"; name: string }
  | { type: "set_link_group"; group: LinkGroup }
  | { type: "undo_turn" };

export interface HelloState {
  sessionId: string;
  sessionPath: string | undefined;
  model: ModelRef | undefined;
  thinkingLevel: ThinkingLevel;
  hip: string | undefined;
  sessionName: string | undefined;
  isStreaming: boolean;
  linkGroup: LinkGroup | undefined;
}

export type ServerMessage =
  | ({ type: "hello" } & HelloState)
  | { type: "state"; model: ModelRef | undefined; thinkingLevel: ThinkingLevel; isStreaming: boolean }
  | { type: "session_name"; name: string | undefined }
  | { type: "link_group"; group: LinkGroup | undefined }
  | { type: "user_message"; text: string }
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "message_end"; role: "assistant"; text: string }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_end"; toolCallId: string; toolName: string; result: string; isError: boolean; durationMs: number; imageUrl?: string }
  | { type: "turn_end"; turnIndex: number }
  | { type: "settled"; aborted: boolean; cost: number; durationMs: number }
  | { type: "models"; models: ModelRef[] }
  | { type: "sessions"; sessions: SessionRef[] }
  | { type: "memory"; text: string; prevAvailable: boolean }
  | { type: "memory_compacted"; before: number; after: number }
  | { type: "error"; message: string; action?: "reconnect" | "login" }
  | { type: "history"; messages: HistoryMessage[] };

export interface HistoryTool {
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: string;
  isError?: boolean;
  /** Where the pane loads the result image: a /session-assets/… path on the sidecar, or a data: URL. */
  imageUrl?: string;
}

export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
  tools?: HistoryTool[];
}

const CLIENT_TYPES: Record<ClientMessage["type"], readonly string[]> = {
  prompt: ["text"],
  steer: ["text"],
  follow_up: ["text"],
  abort: [],
  new_session: [],
  switch_session: ["sessionPath"],
  fork: ["entryId"],
  set_model: ["provider", "modelId"],
  set_thinking: ["level"],
  compact: [],
  list_models: [],
  list_sessions: [],
  memory_read: [],
  memory_edit: ["text"],
  undo_compaction: [],
  rename_session: ["name"],
  set_link_group: ["group"],
  undo_turn: [],
};

const SERVER_TYPES: Record<ServerMessage["type"], readonly string[]> = {
  hello: ["sessionId", "thinkingLevel", "isStreaming"],
  state: ["thinkingLevel", "isStreaming"],
  session_name: [],
  link_group: [],
  user_message: ["text"],
  text_delta: ["delta"],
  thinking_delta: ["delta"],
  message_end: ["role", "text"],
  tool_start: ["toolCallId", "toolName"],
  tool_end: ["toolCallId", "toolName", "result", "isError", "durationMs"],
  turn_end: ["turnIndex"],
  settled: ["aborted", "cost", "durationMs"],
  models: ["models"],
  sessions: ["sessions"],
  memory: ["text", "prevAvailable"],
  memory_compacted: ["before", "after"],
  error: ["message"],
  history: ["messages"],
};

export class ProtocolError extends Error {}

export function encode(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

function decode<T extends { type: string }>(raw: string, table: Record<string, readonly string[]>, side: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ProtocolError(`${side} message is not JSON: ${(error as Error).message}`);
  }
  const is_object = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  if (!is_object) throw new ProtocolError(`${side} message is not an object`);
  const record = parsed as Record<string, unknown>;
  const type = record["type"];
  if (typeof type !== "string" || !(type in table)) {
    throw new ProtocolError(`unknown ${side} message type: ${String(type)}`);
  }
  for (const field of table[type] ?? []) {
    if (!(field in record)) throw new ProtocolError(`${side} message "${type}" is missing "${field}"`);
  }
  return record as unknown as T;
}

export function decodeClient(raw: string): ClientMessage {
  return decode<ClientMessage>(raw, CLIENT_TYPES, "client");
}

export function decodeServer(raw: string): ServerMessage {
  return decode<ServerMessage>(raw, SERVER_TYPES, "server");
}
