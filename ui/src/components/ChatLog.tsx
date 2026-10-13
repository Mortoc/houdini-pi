import { useEffect, useRef, useState } from "react";
import type { ClientMessage } from "@houdini-pi/protocol";
import type { Entry, PaneState } from "../state.js";
import { AnswerBlock } from "./AnswerBlock.js";
import { CopyButton } from "./CopyButton.js";
import { Markdown } from "./Markdown.js";
import { ToolCard } from "./ToolCard.js";

interface Props {
  entries: Entry[];
  lastTurn: PaneState["lastTurn"];
  onUndoTurn: () => void;
  send: (message: ClientMessage) => void;
}

const STICKY_PX = 48;

export function ChatLog({ entries, lastTurn, onUndoTurn, send }: Props) {
  const log = useRef<HTMLElement>(null);
  const [stuck, setStuck] = useState(true);

  // Follow new content only while the reader is at the bottom; scrolling up
  // to read an error must not be undone by the next streamed token.
  useEffect(() => {
    const el = log.current;
    if (el !== null && stuck) el.scrollTop = el.scrollHeight;
  }, [entries, lastTurn, stuck]);

  const onScroll = () => {
    const el = log.current;
    if (el === null) return;
    setStuck(el.scrollHeight - el.scrollTop - el.clientHeight <= STICKY_PX);
  };

  return (
    <main className="chat" data-testid="chat" data-stuck={stuck} ref={log} onScroll={onScroll}>
      {entries.length === 0 && (
        <section className="welcome" data-testid="welcome">
          <h2>Houdini Agent</h2>
          <p>Describe a change to this scene. The agent edits it through Houdini's own tools, one undo step per turn.</p>
          <ul>
            <li>Drag nodes from a network editor onto this pane to talk about them.</li>
            <li>Put this tab and a network editor in the same link group to watch it work.</li>
            <li>Earlier conversations for this and other scenes are in the <b>sessions</b> tab.</li>
          </ul>
        </section>
      )}
      {entries.map((entry) => {
        if (entry.kind === "user") return <div key={entry.id} className="bubble user" data-testid="user-bubble">{entry.text}</div>;
        if (entry.kind === "notice")
          return (
            <div key={entry.id} className={`notice ${entry.level}`} data-testid="notice">
              <CopyButton text={entry.text} />
              <span className="notice-text">{entry.text}</span>
              {entry.action === "reconnect" && <button onClick={() => window.location.reload()}>reconnect</button>}
              {entry.action === "login" && <span className="hint">Run <code>pi</code> in a terminal and <code>/login</code>, then retry.</span>}
            </div>
          );
        return (
          <div key={entry.id} className={`bubble assistant${entry.streaming ? " streaming" : ""}`} data-testid="assistant-bubble">
            {entry.thinking.length > 0 && !entry.streaming && (
              <details className="thinking-log" data-testid="thinking-log">
                <summary>thinking</summary>
                <pre>{entry.thinking}</pre>
              </details>
            )}
            {entry.tools.map((tool) =>
              tool.answer !== undefined ? <AnswerBlock key={tool.toolCallId} answer={tool.answer} send={send} /> : <ToolCard key={tool.toolCallId} tool={tool} />,
            )}
            {entry.tools.some((t) => t.answer !== undefined) && entry.text.trim().length > 0 ? (
              <details className="narration" data-testid="narration">
                <summary>{entry.streaming ? "reply" : "Done"}</summary>
                <Markdown text={entry.text} />
              </details>
            ) : (
              <Markdown text={entry.text} />
            )}
          </div>
        );
      })}
      {lastTurn !== undefined && (
        <footer className={`turn-footer ${lastTurn.aborted ? "aborted" : lastTurn.errors > 0 ? "with-errors" : "ok"}`} data-testid="turn-footer">
          <span className="verdict">{lastTurn.aborted ? "Aborted" : lastTurn.errors > 0 ? `Done, ${lastTurn.errors} tool error${lastTurn.errors === 1 ? "" : "s"}` : "✓ Done"}</span>
          <span className="meta">{(lastTurn.durationMs / 1000).toFixed(1)}s · ${lastTurn.cost.toFixed(4)}</span>
          {lastTurn.aborted && (
            <button className="undo-turn" data-testid="undo-turn" onClick={onUndoTurn} title="Revert everything this turn did in Houdini and put your message back in the box">
              ↶ Undo
            </button>
          )}
        </footer>
      )}
      {!stuck && (
        <button className="jump-down" data-testid="jump-down" onClick={() => setStuck(true)} title="Follow new messages">
          ↓ latest
        </button>
      )}
    </main>
  );
}
