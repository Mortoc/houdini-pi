import type { ClientMessage, ThinkingLevel } from "@houdini-pi/protocol";
import type { Tab } from "../App.js";
import type { PaneState } from "../state.js";
import type { Status } from "../ws.js";
import { ModelPicker } from "./ModelPicker.js";

const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

interface Props {
  state: PaneState;
  status: Status;
  send: (message: ClientMessage) => void;
  tab: Tab;
  onTab: (tab: Tab) => void;
}

export function Toolbar({ state, status, send, tab, onTab }: Props) {
  const hip = state.hello?.hip?.split("/").at(-1) ?? "untitled";
  return (
    <header className="toolbar">
      <div className="toolbar-row">
        <strong className="hip" title={state.hello?.hip ?? "untitled scene"} data-testid="hip">
          {hip}
        </strong>
        <span className="session-name" data-testid="session-name" title="Named automatically from the conversation">
          {state.sessionName}
        </span>
        <span className="spacer" />
        {status !== "open" && (
          <span className={`status status-${status}`} data-testid="status" title="Connection to the houdini-pi sidecar">
            {status === "connecting" ? "connecting to sidecar…" : "sidecar disconnected, reconnecting…"}
          </span>
        )}
        <button className="new-session" data-testid="new-session" onClick={() => send({ type: "new_session" })} title="Start a fresh conversation for this scene">
          New Conversation
        </button>
      </div>
      <div className="toolbar-row">
        <nav className="tabs" role="tablist">
          {(["chat", "memory", "sessions"] as const).map((name) => (
            <button key={name} role="tab" aria-selected={tab === name} onClick={() => onTab(name)}>
              {name}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <ModelPicker models={state.models} current={state.model} onPick={(m) => send({ type: "set_model", provider: m.provider, modelId: m.id })} />
        <select aria-label="thinking level" data-testid="thinking-picker" value={state.thinkingLevel} onChange={(e) => send({ type: "set_thinking", level: e.target.value as ThinkingLevel })}>
          {LEVELS.map((level) => (
            <option key={level} value={level}>
              thinking: {level}
            </option>
          ))}
        </select>
      </div>
    </header>
  );
}
