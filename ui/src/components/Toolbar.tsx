import type { ClientMessage, LinkGroup, ThinkingLevel } from "@houdini-pi/protocol";
import type { Tab } from "../App.js";
import type { PaneState } from "../state.js";
import type { Status } from "../ws.js";
import { Dropdown } from "./Dropdown.js";
import { ModelPicker } from "./ModelPicker.js";

const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const LINKS: { value: LinkGroup; label: string }[] = [
  { value: "none", label: "No Link" },
  ...(["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((n) => ({ value: n, label: `Link ${n}` })),
  { value: "selection", label: "Last Selected Node" },
];

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
        <Dropdown<LinkGroup>
          label="link pane tab"
          testId="link-picker"
          title="Link Pane Tab: panes in the same group follow the node the agent works on"
          value={state.linkGroup ?? "none"}
          options={LINKS}
          disabled={state.linkGroup === undefined}
          onChange={(group) => send({ type: "set_link_group", group })}
        />
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
        <Dropdown<ThinkingLevel>
          label="thinking level"
          testId="thinking-picker"
          value={state.thinkingLevel}
          options={LEVELS.map((level) => ({ value: level, label: `thinking: ${level}` }))}
          onChange={(level) => send({ type: "set_thinking", level })}
        />
      </div>
    </header>
  );
}
