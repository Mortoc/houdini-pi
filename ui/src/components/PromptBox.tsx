import { type KeyboardEvent, useState } from "react";
import type { ClientMessage } from "@houdini-pi/protocol";

interface Props {
  streaming: boolean;
  connected: boolean;
  send: (message: ClientMessage) => void;
}

export function PromptBox({ streaming, connected, send }: Props) {
  const [text, setText] = useState("");
  const submit = () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    send(streaming ? { type: "steer", text: trimmed } : { type: "prompt", text: trimmed });
    setText("");
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
      <textarea
        data-testid="prompt"
        value={text}
        placeholder={streaming ? "Steer the agent…" : "What should change in the scene?"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        disabled={!connected}
        rows={2}
      />
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
