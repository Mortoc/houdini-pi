import { marked } from "marked";
import { useMemo } from "react";

marked.setOptions({ gfm: true, breaks: true });

/** Markdown from the model. Rendered through marked; the sidecar is local and the model's text is the only input. */
export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => marked.parse(text, { async: false }) as string, [text]);
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
