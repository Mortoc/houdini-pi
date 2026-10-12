import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelRef } from "@houdini-pi/protocol";

interface Props {
  models: ModelRef[];
  current: ModelRef | undefined;
  onPick: (model: ModelRef) => void;
}

function matches(model: ModelRef, query: string): boolean {
  const haystack = `${model.provider} ${model.name} ${model.id}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .every((word) => haystack.includes(word));
}

/** A searchable model list: type to filter, arrows to move, Enter to pick. */
export function ModelPicker({ models, current, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => models.filter((m) => matches(m, query)).slice(0, 200), [models, query]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => setActive(0), [query]);

  const pick = (model: ModelRef) => {
    onPick(model);
    setOpen(false);
    setQuery("");
  };

  const label = current === undefined ? "no model" : `${current.provider} · ${current.name}`;
  return (
    <div className="model-picker" ref={root}>
      <button type="button" className="model-current" data-testid="model-picker" title={current ? `${current.provider}/${current.id}` : "no model"} onClick={() => setOpen(!open)}>
        {label} ▾
      </button>
      {open && (
        <div className="model-popup" data-testid="model-popup">
          <input
            ref={input}
            data-testid="model-search"
            placeholder="search models…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === "Enter" && filtered[active]) { e.preventDefault(); pick(filtered[active]); }
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <ul role="listbox">
            {filtered.map((model, index) => {
              const is_current = current !== undefined && model.provider === current.provider && model.id === current.id;
              return (
                <li
                  key={`${model.provider}/${model.id}`}
                  role="option"
                  aria-selected={is_current}
                  className={index === active ? "active" : ""}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(model)}
                >
                  <span className="model-provider">{model.provider}</span>
                  <span className="model-name">{model.name}</span>
                  {model.reasoning && <span className="model-tag">thinking</span>}
                </li>
              );
            })}
            {filtered.length === 0 && <li className="muted">no model matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
