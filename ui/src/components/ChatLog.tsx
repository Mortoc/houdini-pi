import { useEffect, useRef } from "react";
import type { ClientMessage } from "@houdini-pi/protocol";
import type { Entry, PaneState } from "../state.js";
import { Markdown } from "./Markdown.js";
import { ToolCard } from "./ToolCard.js";

interface Props {
  entries: Entry[];
  lastTurn: PaneState["lastTurn"];
  send: (message: ClientMessage) => void;
}

export function ChatLog({ entries, lastTurn, send }: Props) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [entries]);
  return (
    <main className="chat" data-testid="chat">
      {entries.length === 0 && <p className="muted empty">Ask for a change to the scene. Each answer is one undo step in Houdini.</p>}
      {entries.map((entry) => {
        if (entry.kind === "user") return <div key={entry.id} className="bubble user" data-testid="user-bubble">{entry.text}</div>;
        if (entry.kind === "notice")
          return (
            <div key={entry.id} className={`notice ${entry.level}`} data-testid="notice">
              <span>{entry.text}</span>
              {entry.action === "reconnect" && <button onClick={() => window.location.reload()}>reconnect</button>}
              {entry.action === "login" && <span className="hint">Run <code>pi</code> in a terminal and <code>/login</code>, then retry.</span>}
            </div>
          );
        return (
          <div key={entry.id} className={`bubble assistant${entry.streaming ? " streaming" : ""}`} data-testid="assistant-bubble">
            {entry.thinking.length > 0 && (
              <details className="thinking" data-testid="thinking">
                <summary>thinking</summary>
                <pre>{entry.thinking}</pre>
              </details>
            )}
            {entry.tools.map((tool) => <ToolCard key={tool.toolCallId} tool={tool} />)}
            <Markdown text={entry.text} />
          </div>
        );
      })}
      {lastTurn !== undefined && (
        <footer className="turn-footer" data-testid="turn-footer">
          {lastTurn.aborted ? "aborted" : "done"} · {(lastTurn.durationMs / 1000).toFixed(1)}s · ${lastTurn.cost.toFixed(4)} ·{" "}
          <button className="link" onClick={() => send({ type: "undo_turn" })}>undo this turn in Houdini</button>
        </footer>
      )}
      <div ref={end} />
    </main>
  );
}
