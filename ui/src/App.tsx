import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ClientMessage } from "@houdini-pi/protocol";
import { ActivityBar } from "./components/ActivityBar.js";
import { ChatLog } from "./components/ChatLog.js";
import { MemoryTab } from "./components/MemoryTab.js";
import { PromptBox } from "./components/PromptBox.js";
import { SessionsTab } from "./components/SessionsTab.js";
import { Toolbar } from "./components/Toolbar.js";
import { initialState, reduce } from "./state.js";
import { PaneSocket, type Status } from "./ws.js";

export type Tab = "chat" | "memory" | "sessions";

export function App() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [status, setStatus] = useState<Status>("connecting");
  const [tab, setTab] = useState<Tab>("chat");
  const [droppedNodes, setDroppedNodes] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const socketRef = useRef<PaneSocket | undefined>(undefined);

  useEffect(() => {
    const socket = new PaneSocket(PaneSocket.urlFromPage(window.location));
    socket.onMessage = dispatch;
    socket.onStatus = (next) => {
      setStatus(next);
      if (next === "open") socket.send({ type: "list_models" });
    };
    socket.connect();
    socketRef.current = socket;
    return () => socket.close();
  }, []);

  const send = useMemo(
    () => (message: ClientMessage) => {
      try {
        socketRef.current?.send(message);
      } catch (error) {
        dispatch({ type: "error", message: (error as Error).message, action: "reconnect" });
      }
    },
    [],
  );

  const openTab = (next: Tab) => {
    setTab(next);
    if (next === "sessions") send({ type: "list_sessions" });
    if (next === "memory") send({ type: "memory_read" });
  };

  // Houdini drags node paths as plain text, one per line. Anything that
  // looks like an absolute node path becomes a reference in the prompt.
  const onDrop = (event: React.DragEvent) => {
    const text = event.dataTransfer.getData("text/plain");
    const paths = nodePathsIn(text);
    if (paths.length === 0) return;
    event.preventDefault();
    setTab("chat");
    setDroppedNodes((current) => [...current, ...paths.filter((p) => !current.includes(p))]);
  };

  return (
    <div className="pane" data-status={status} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <Toolbar state={state} status={status} send={send} tab={tab} onTab={openTab} />
      {tab === "chat" && (
        <>
          <ChatLog
            entries={state.entries}
            lastTurn={state.lastTurn}
            onUndoTurn={() => {
              // Revert the whole turn in Houdini (it is one undo group), drop it
              // from the log, and hand the message back to the artist to edit.
              send({ type: "undo_turn" });
              const lastUser = [...state.entries].reverse().find((e) => e.kind === "user");
              if (lastUser?.kind === "user") setDraft(lastUser.text);
              dispatch({ type: "drop_last_turn" });
            }}
          />
          <ActivityBar activity={state.activity} streaming={state.isStreaming} onStop={() => send({ type: "abort" })} />
          <PromptBox streaming={state.isStreaming} connected={status === "open"} send={send} nodes={droppedNodes} onNodesChange={setDroppedNodes} draft={draft} onDraftChange={setDraft} />
        </>
      )}
      {tab === "memory" && <MemoryTab memory={state.memory} compaction={state.compaction} send={send} />}
      {tab === "sessions" && <SessionsTab sessions={state.sessions} current={state.hello?.sessionPath} hip={state.hello?.hip} send={send} onOpen={() => setTab("chat")} />}
    </div>
  );
}

export function nodePathsIn(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => /^\/[A-Za-z0-9_\/.:-]+$/.test(token) && token.length > 1);
}
