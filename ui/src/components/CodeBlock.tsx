import { useMemo } from "react";
import { tokenize } from "../highlight.js";
import { CopyButton } from "./CopyButton.js";

/** Code the model wrote, syntax-coloured, four lines tall with a scrollbar past that. */
export const VISIBLE_LINES = 4;

export function CodeBlock({ code, language }: { code: string; language: "python" | "javascript" }) {
  const tokens = useMemo(() => tokenize(code), [code]);
  const lines = code.replace(/\n$/, "").split("\n").length;
  const fits = lines <= VISIBLE_LINES;
  return (
    <div className="code-wrap">
      <CopyButton text={code} />
      <pre className={`code-block${fits ? " fits" : ""}`} data-testid="code-block" data-language={language} data-lines={lines}>
        <code>
          {tokens.map((token, index) => (
            <span key={index} className={`tok-${token.kind}`}>{token.text}</span>
          ))}
        </code>
      </pre>
    </div>
  );
}
