import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ModelKey, ModelRef } from "@houdini-pi/protocol";
import { arrangeModels, modelLabel, sameModel } from "../model-list.js";

interface Props {
  models: ModelRef[];
  current: ModelRef | undefined;
  /** The curated models, best first (Recommended); the order is the sidecar's. */
  recommended: ModelKey[];
  /** What a new conversation starts on; labelled "(Default)" in the list. */
  defaultModel: ModelKey | undefined;
  /** False until the artist picks one: the button then reads "Default". */
  picked: boolean;
  onPick: (model: ModelRef) => void;
}

/**
 * A searchable model list: type to filter, arrows to move, Enter to pick. The selected
 * model is first, then Recommended, then the rest (`arrangeModels`); the arrows run
 * through the sections as one list.
 */
export function ModelPicker({ models, current, recommended, defaultModel, picked, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const sections = useMemo(() => arrangeModels(models, current, recommended, query), [models, current, recommended, query]);
  const flat = useMemo(() => sections.flatMap((s) => s.models), [sections]);

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

  const label = current === undefined ? "Model: none" : `Model: ${picked ? current.name : "Default"}`;
  let index = -1;
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
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === "Enter" && flat[active]) { e.preventDefault(); pick(flat[active]); }
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <ul role="listbox">
            {sections.map((section) => (
              <Fragment key={section.title ?? "selected"}>
                {section.title !== undefined && (
                  <li className="model-section" role="presentation" data-testid="model-section">
                    {section.title}
                  </li>
                )}
                {section.models.map((model) => {
                  index += 1;
                  const position = index;
                  return (
                    <li
                      key={`${model.provider}/${model.id}`}
                      role="option"
                      aria-selected={sameModel(model, current)}
                      className={position === active ? "active" : ""}
                      onMouseEnter={() => setActive(position)}
                      onClick={() => pick(model)}
                    >
                      <span className="model-provider">{model.provider}</span>
                      <span className="model-name">{modelLabel(model, defaultModel)}</span>
                      {model.reasoning && <span className="model-tag">thinking</span>}
                    </li>
                  );
                })}
              </Fragment>
            ))}
            {flat.length === 0 && <li className="muted">no model matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
