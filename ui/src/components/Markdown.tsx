import { marked } from "marked";
import { useMemo } from "react";

marked.setOptions({ gfm: true, breaks: true });

// Links in model text are inert: this pane is an app, not a browser. A
// navigable <a> would tear the agent out of the window.
const renderer = new marked.Renderer();
renderer.link = ({ href, text }) => `<span class="link" title="${href.replace(/"/g, "&quot;")}">${text}</span>`;

/** Markdown from the model. Rendered through marked; the sidecar is local and the model's text is the only input. */
export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => marked.parse(text, { async: false, renderer }) as string, [text]);
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
