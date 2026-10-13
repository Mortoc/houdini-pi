import type { KeyboardEvent } from "react";
import type { ClientMessage, ThinkingLevel } from "@houdini-pi/protocol";
import { Dropdown } from "./Dropdown.js";

const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

interface Props {
  streaming: boolean;
  connected: boolean;
  thinkingLevel: ThinkingLevel;
  send: (message: ClientMessage) => void;
  nodes: string[];
  onNodesChange: (nodes: string[]) => void;
  draft: string;
  onDraftChange: (text: string) => void;
}

export function PromptBox({ streaming, connected, thinkingLevel, send, nodes, onNodesChange, draft, onDraftChange }: Props) {
  const submit = () => {
    const trimmed = draft.trim();
    const nothing = trimmed.length === 0 && nodes.length === 0;
    if (nothing) return;
    const refs = nodes.length === 0 ? "" : `\n\nRefs: ${nodes.map((n) => `\`${n}\``).join(", ")}`;
    const full = `${trimmed}${refs}`.trim();
    send(streaming ? { type: "steer", text: full } : { type: "prompt", text: full });
    onDraftChange("");
    onNodesChange([]);
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const plain_enter = event.key === "Enter" && !event.shiftKey;
    if (plain_enter) {
      event.preventDefault();
      submit();
    }
  };
  return (
    <form className="prompt" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="prompt-main">
        {nodes.length > 0 && (
          <div className="node-chips" data-testid="node-chips">
            {nodes.map((node) => (
              <span key={node} className="chip" title={node}>
                {node}
                <button type="button" className="chip-remove" aria-label={`remove ${node}`} title="Remove" onClick={() => onNodesChange(nodes.filter((n) => n !== node))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          data-testid="prompt"
          value={draft}
          placeholder={streaming ? "Steer the agent…" : "What should change in the scene? Drop nodes here to reference them."}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={onKey}
          disabled={!connected}
          rows={2}
        />
      </div>
      <div className="prompt-actions">
        <button type="submit" data-testid="send" disabled={!connected}>
          {streaming ? "steer" : "send"}
        </button>
        <Dropdown<ThinkingLevel>
          label="thinking level"
          testId="thinking-picker"
          title="How much the model reasons before acting"
          prefix="thinking: "
          up
          value={thinkingLevel}
          options={LEVELS.map((level) => ({ value: level, label: level }))}
          onChange={(level) => send({ type: "set_thinking", level })}
        />
      </div>
    </form>
  );
}
