import { useMemo } from "react";
import { tokenize } from "../highlight.js";

/** Code the model wrote, syntax-coloured, four lines tall with a scrollbar past that. */
export function CodeBlock({ code, language }: { code: string; language: "python" | "javascript" }) {
  const tokens = useMemo(() => tokenize(code), [code]);
  return (
    <pre className="code-block" data-testid="code-block" data-language={language}>
      <code>
        {tokens.map((token, index) => (
          <span key={index} className={`tok-${token.kind}`}>{token.text}</span>
        ))}
      </code>
    </pre>
  );
}
