import type { ClientMessage, SessionRef } from "@houdini-pi/protocol";

interface Props {
  sessions: SessionRef[];
  current: string | undefined;
  send: (message: ClientMessage) => void;
  onOpen: () => void;
}

export function SessionsTab({ sessions, current, send, onOpen }: Props) {
  return (
    <ul className="sessions" data-testid="sessions">
      {sessions.map((s) => (
        <li key={s.path}>
          <button className={s.path === current ? "current" : ""} onClick={() => { send({ type: "switch_session", sessionPath: s.path }); onOpen(); }}>
            <span className="session-title">{s.name ?? (s.firstMessage || "New Conversation")}</span>
            <span className="session-date">{new Date(s.modified).toLocaleString()}</span>
          </button>
        </li>
      ))}
      {sessions.length === 0 && <li className="muted">No conversations yet for this scene.</li>}
    </ul>
  );
}
