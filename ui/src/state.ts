import type { HelloState, ModelRef, ServerMessage, SessionRef, ThinkingLevel } from "@houdini-pi/protocol";

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: string;
  isError?: boolean;
  durationMs?: number;
  image?: { mimeType: string; data: string };
}

export type Entry =
  | { kind: "user"; id: number; text: string }
  | { kind: "assistant"; id: number; text: string; thinking: string; tools: ToolCall[]; streaming: boolean }
  | { kind: "notice"; id: number; text: string; level: "info" | "error"; action?: "reconnect" | "login" };

export interface PaneState {
  hello: HelloState | undefined;
  model: ModelRef | undefined;
  thinkingLevel: ThinkingLevel;
  isStreaming: boolean;
  sessionName: string;
  entries: Entry[];
  models: ModelRef[];
  sessions: SessionRef[];
  memory: { text: string; prevAvailable: boolean } | undefined;
  lastTurn: { cost: number; durationMs: number; aborted: boolean; errors: number } | undefined;
  compaction: { before: number; after: number } | undefined;
}

export const initialState: PaneState = {
  hello: undefined,
  model: undefined,
  thinkingLevel: "medium",
  isStreaming: false,
  sessionName: "New Conversation",
  entries: [],
  models: [],
  sessions: [],
  memory: undefined,
  lastTurn: undefined,
  compaction: undefined,
};

let nextId = 1;

function openAssistant(entries: Entry[]): Entry[] {
  const last = entries.at(-1);
  const open = last?.kind === "assistant" && last.streaming;
  if (open) return entries;
  return [...entries, { kind: "assistant", id: nextId++, text: "", thinking: "", tools: [], streaming: true }];
}

function updateLastAssistant(entries: Entry[], update: (entry: Extract<Entry, { kind: "assistant" }>) => Entry): Entry[] {
  const withOpen = openAssistant(entries);
  const last = withOpen.at(-1) as Extract<Entry, { kind: "assistant" }>;
  return [...withOpen.slice(0, -1), update(last)];
}

export function reduce(state: PaneState, message: ServerMessage): PaneState {
  switch (message.type) {
    case "hello": {
      const { type: _type, ...hello } = message;
      return { ...state, hello, model: hello.model, thinkingLevel: hello.thinkingLevel, isStreaming: hello.isStreaming, sessionName: hello.sessionName ?? "New Conversation", entries: [], lastTurn: undefined };
    }
    case "history":
      return {
        ...state,
        entries: message.messages.map((m): Entry =>
          m.role === "user" ? { kind: "user", id: nextId++, text: m.text } : { kind: "assistant", id: nextId++, text: m.text, thinking: "", tools: [], streaming: false },
        ),
      };
    case "state":
      return { ...state, model: message.model, thinkingLevel: message.thinkingLevel, isStreaming: message.isStreaming };
    case "session_name":
      return { ...state, sessionName: message.name ?? "New Conversation" };
    case "user_message":
      return { ...state, isStreaming: true, entries: [...state.entries, { kind: "user", id: nextId++, text: message.text }] };
    case "text_delta":
      return { ...state, entries: updateLastAssistant(state.entries, (e) => ({ ...e, text: e.text + message.delta })) };
    case "thinking_delta":
      return { ...state, entries: updateLastAssistant(state.entries, (e) => ({ ...e, thinking: e.thinking + message.delta })) };
    case "tool_start":
      return { ...state, entries: updateLastAssistant(state.entries, (e) => ({ ...e, tools: [...e.tools, { toolCallId: message.toolCallId, toolName: message.toolName, args: message.args }] })) };
    case "tool_end":
      return {
        ...state,
        entries: updateLastAssistant(state.entries, (e) => ({
          ...e,
          tools: e.tools.map((t) => (t.toolCallId === message.toolCallId ? { ...t, result: message.result, isError: message.isError, durationMs: message.durationMs, ...(message.image ? { image: message.image } : {}) } : t)),
        })),
      };
    case "message_end":
      return { ...state, entries: updateLastAssistant(state.entries, (e) => ({ ...e, text: message.text || e.text })) };
    case "turn_end":
      return state;
    case "settled": {
      const entries = state.entries.map((e): Entry => (e.kind === "assistant" && e.streaming ? { ...e, streaming: false, text: message.aborted && e.text === "" ? "(aborted)" : e.text } : e));
      const errors = state.entries.filter((e): e is Extract<Entry, { kind: "assistant" }> => e.kind === "assistant" && e.streaming).flatMap((e) => e.tools).filter((t) => t.isError).length;
      return { ...state, isStreaming: false, entries, lastTurn: { cost: message.cost, durationMs: message.durationMs, aborted: message.aborted, errors } };
    }
    case "models":
      return { ...state, models: message.models };
    case "sessions":
      return { ...state, sessions: message.sessions };
    case "memory":
      return { ...state, memory: { text: message.text, prevAvailable: message.prevAvailable } };
    case "memory_compacted":
      return { ...state, compaction: { before: message.before, after: message.after } };
    case "error":
      return { ...state, entries: [...state.entries, { kind: "notice", id: nextId++, text: message.message, level: "error", ...(message.action ? { action: message.action } : {}) }] };
  }
}
