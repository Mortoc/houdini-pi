import { type KeyboardEvent, useState } from "react";
import type { ClientMessage } from "@houdini-pi/protocol";

interface Props {
  streaming: boolean;
  connected: boolean;
  send: (message: ClientMessage) => void;
  nodes: string[];
  onNodesChange: (nodes: string[]) => void;
}

export function PromptBox({ streaming, connected, send, nodes, onNodesChange }: Props) {
  const [text, setText] = useState("");
  const submit = () => {
    const trimmed = text.trim();
    const nothing = trimmed.length === 0 && nodes.length === 0;
    if (nothing) return;
    const refs = nodes.length === 0 ? "" : `\n\nNodes: ${nodes.map((n) => `\`${n}\``).join(", ")}`;
    const full = `${trimmed}${refs}`.trim();
    send(streaming ? { type: "steer", text: full } : { type: "prompt", text: full });
    setText("");
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
                <button type="button" aria-label={`remove ${node}`} onClick={() => onNodesChange(nodes.filter((n) => n !== node))}>×</button>
              </span>
            ))}
          </div>
        )}
        <textarea
          data-testid="prompt"
          value={text}
          placeholder={streaming ? "Steer the agent…" : "What should change in the scene? Drop nodes here to reference them."}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          disabled={!connected}
          rows={2}
        />
      </div>
      <div className="prompt-actions">
        {streaming && (
          <button type="button" className="abort" data-testid="abort" onClick={() => send({ type: "abort" })}>
            abort
          </button>
        )}
        <button type="submit" data-testid="send" disabled={!connected}>
          {streaming ? "steer" : "send"}
        </button>
      </div>
    </form>
  );
}
