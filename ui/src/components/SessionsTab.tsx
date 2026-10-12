import type { ClientMessage, SessionRef } from "@houdini-pi/protocol";

interface Props {
  sessions: SessionRef[];
  current: string | undefined;
  hip: string | undefined;
  send: (message: ClientMessage) => void;
  onOpen: () => void;
}

function baseName(path: string | undefined): string {
  return path?.split("/").at(-1) ?? "untitled";
}

/** Conversations grouped by the scene they worked on; this scene first. Opening one opens its hip. */
export function SessionsTab({ sessions, current, hip, send, onOpen }: Props) {
  const groups = new Map<string, SessionRef[]>();
  for (const session of [...sessions].sort((a, b) => b.modified - a.modified)) {
    const key = session.hip ?? "";
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === (hip ?? "") ? -1 : b === (hip ?? "") ? 1 : a.localeCompare(b)));
  return (
    <div className="sessions" data-testid="sessions">
      {ordered.map(([key, list]) => (
        <section key={key || "(no scene)"} className="session-group">
          <h3>{key === "" ? "no scene recorded" : key === hip ? `${baseName(key)} (this scene)` : baseName(key)}</h3>
          <ul>
            {list.map((s) => (
              <li key={s.path}>
                <button
                  className={s.path === current ? "current" : ""}
                  title={s.hip === undefined || s.hip === hip ? "Open this conversation" : `Open this conversation and load ${s.hip}`}
                  onClick={() => {
                    send({ type: "switch_session", sessionPath: s.path });
                    onOpen();
                  }}
                >
                  <span className="session-title">{s.name ?? (s.firstMessage || "New Conversation")}</span>
                  <span className="session-date">{new Date(s.modified).toLocaleString()}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {sessions.length === 0 && <p className="muted">No conversations yet.</p>}
    </div>
  );
}
