import type { ClientMessage, ThinkingLevel } from "@houdini-pi/protocol";
import type { PaneState } from "../state.js";
import type { Status } from "../ws.js";

const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

interface Props {
  state: PaneState;
  status: Status;
  send: (message: ClientMessage) => void;
  tab: "chat" | "memory" | "sessions";
  onTab: (tab: "chat" | "memory" | "sessions") => void;
}

export function Toolbar({ state, status, send, tab, onTab }: Props) {
  const modelKey = state.model === undefined ? "" : `${state.model.provider}/${state.model.id}`;
  return (
    <header className="toolbar">
      <nav className="tabs" role="tablist">
        {(["chat", "memory", "sessions"] as const).map((name) => (
          <button key={name} role="tab" aria-selected={tab === name} onClick={() => onTab(name)}>
            {name}
          </button>
        ))}
      </nav>
      <span className="hip" title={state.hello?.hip ?? "untitled"} data-testid="hip">
        {state.hello?.hip?.split("/").at(-1) ?? "untitled"}
      </span>
      <select
        aria-label="model"
        data-testid="model-picker"
        value={modelKey}
        onChange={(event) => {
          const [provider, ...rest] = event.target.value.split("/");
          send({ type: "set_model", provider: provider!, modelId: rest.join("/") });
        }}
      >
        {state.model !== undefined && !state.models.some((m) => `${m.provider}/${m.id}` === modelKey) && (
          <option value={modelKey}>{state.model.name}</option>
        )}
        {state.models.map((m) => (
          <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
            {m.provider} · {m.name}
          </option>
        ))}
      </select>
      <select aria-label="thinking level" data-testid="thinking-picker" value={state.thinkingLevel} onChange={(e) => send({ type: "set_thinking", level: e.target.value as ThinkingLevel })}>
        {LEVELS.map((level) => (
          <option key={level} value={level}>
            thinking: {level}
          </option>
        ))}
      </select>
      <label className="file-tools" title="Let the agent run bash, edit and write on this machine">
        <input type="checkbox" data-testid="file-tools" checked={state.fileTools} onChange={(e) => send({ type: "set_file_tools", enabled: e.target.checked })} />
        file tools
      </label>
      <button className="new-session" onClick={() => send({ type: "new_session" })} title="Start a fresh conversation">
        new
      </button>
      <span className={`status status-${status}`} data-testid="status">
        {status}
      </span>
    </header>
  );
}
