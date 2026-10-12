import { useEffect, useState } from "react";
import type { ClientMessage } from "@houdini-pi/protocol";
import type { PaneState } from "../state.js";

interface Props {
  memory: PaneState["memory"];
  compaction: PaneState["compaction"];
  send: (message: ClientMessage) => void;
}

export function MemoryTab({ memory, compaction, send }: Props) {
  const [draft, setDraft] = useState(memory?.text ?? "");
  useEffect(() => {
    setDraft(memory?.text ?? "");
  }, [memory?.text]);
  const dirty = draft !== (memory?.text ?? "");
  return (
    <section className="memory" data-testid="memory">
      <p className="muted">Project memory lives inside this .hip and is shown to the agent every turn. Decisions and conventions belong here, narration does not.</p>
      {compaction && (
        <p className="notice info" data-testid="compaction-notice">
          Memory was compacted from ~{compaction.before} to ~{compaction.after} tokens.
        </p>
      )}
      <textarea data-testid="memory-text" value={draft} onChange={(e) => setDraft(e.target.value)} rows={18} />
      <div className="memory-actions">
        <button data-testid="memory-save" disabled={!dirty} onClick={() => send({ type: "memory_edit", text: draft })}>
          save to hip
        </button>
        <button data-testid="memory-undo" disabled={!memory?.prevAvailable} onClick={() => send({ type: "undo_compaction" })}>
          undo compaction
        </button>
      </div>
    </section>
  );
}
