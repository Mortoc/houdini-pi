import { useState } from "react";

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // QWebEngineView without clipboard permission: fall back to the selection API.
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

/** Overlay button, top-right of any text block, copying `text` to the clipboard. */
export function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`copy-button${copied ? " copied" : ""}`}
      data-testid="copy-button"
      title="Copy to clipboard"
      onClick={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await copyText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? "copied" : label}
    </button>
  );
}
