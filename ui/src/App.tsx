import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ClientMessage } from "@houdini-pi/protocol";
import { ChatLog } from "./components/ChatLog.js";
import { MemoryTab } from "./components/MemoryTab.js";
import { PromptBox } from "./components/PromptBox.js";
import { Toolbar } from "./components/Toolbar.js";
import { initialState, reduce } from "./state.js";
import { PaneSocket, type Status } from "./ws.js";

type Tab = "chat" | "memory" | "sessions";

export function App() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [status, setStatus] = useState<Status>("connecting");
  const [tab, setTab] = useState<Tab>("chat");
  const socketRef = useRef<PaneSocket | undefined>(undefined);

  useEffect(() => {
    const socket = new PaneSocket(PaneSocket.urlFromPage(window.location));
    socket.onMessage = dispatch;
    socket.onStatus = (next) => {
      setStatus(next);
      if (next === "open") {
        socket.send({ type: "list_models" });
      }
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

  return (
    <div className="pane" data-status={status}>
      <Toolbar state={state} status={status} send={send} tab={tab} onTab={openTab} />
      {tab === "chat" && (
        <>
          <ChatLog entries={state.entries} lastTurn={state.lastTurn} send={send} />
          <PromptBox streaming={state.isStreaming} connected={status === "open"} send={send} />
        </>
      )}
      {tab === "memory" && <MemoryTab memory={state.memory} compaction={state.compaction} send={send} />}
      {tab === "sessions" && (
        <ul className="sessions" data-testid="sessions">
          {state.sessions.map((s) => (
            <li key={s.path}>
              <button onClick={() => { send({ type: "switch_session", sessionPath: s.path }); setTab("chat"); }}>
                <span className="session-name">{s.name ?? (s.firstMessage || "(empty)")}</span>
                <span className="session-date">{new Date(s.modified).toLocaleString()}</span>
              </button>
            </li>
          ))}
          {state.sessions.length === 0 && <li className="muted">No sessions yet for this hip.</li>}
        </ul>
      )}
    </div>
  );
}
