import { useEffect, useRef, useState } from "react";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  label: string;
  testId: string;
  disabled?: boolean;
  title?: string;
  /** Shown before the current value on the button only, not in the list. */
  prefix?: string;
  /** Open the list above the button, for controls at the bottom of the pane. */
  up?: boolean;
}

/**
 * An in-page replacement for <select>. QtWebEngine positions a native select
 * popup relative to the wrong window when the view is docked in Houdini, so
 * the list opened far from the control; this one is a plain absolutely
 * positioned list inside the page.
 */
export function Dropdown<T extends string>({ value, options, onChange, label, testId, disabled, title, prefix, up }: Props<T>) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="dropdown" ref={root}>
      <button
        type="button"
        className="dropdown-current"
        data-testid={testId}
        data-value={value}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        title={title}
        onClick={() => setOpen(!open)}
      >
        {prefix}{current?.label ?? value} ▾
      </button>
      {open && (
        <ul className={up ? "dropdown-list up" : "dropdown-list"} role="listbox" aria-label={label} data-testid={`${testId}-list`}>
          {options.map((option) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
