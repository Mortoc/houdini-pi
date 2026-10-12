import type { ToolCall } from "../state.js";
import { CodeBlock } from "./CodeBlock.js";

function houdiniSummary(tool: ToolCall): string | undefined {
  const is_houdini = tool.toolName.startsWith("mcp__fxhoudini__");
  if (!is_houdini) return undefined;
  const args = (tool.args ?? {}) as Record<string, unknown>;
  const parts = [args["node_path"], args["parm_name"], args["node_type"], args["name"]].filter((v) => typeof v === "string") as string[];
  return parts.join(" · ");
}

/** The script a code-running tool was given, with its language, or undefined for every other tool. */
export function scriptOf(tool: ToolCall): { code: string; language: "python" | "javascript" } | undefined {
  const args = (tool.args ?? {}) as Record<string, unknown>;
  const is_python = tool.toolName === "mcp__fxhoudini__execute_python" && typeof args["code"] === "string";
  if (is_python) return { code: args["code"] as string, language: "python" };
  const script = args["code"] ?? args["script"];
  const is_codemode = tool.toolName === "codemode" && typeof script === "string";
  if (is_codemode) return { code: script as string, language: "javascript" };
  return undefined;
}

export function ToolCard({ tool }: { tool: ToolCall }) {
  const label = tool.toolName.replace(/^mcp__fxhoudini__/, "houdini: ");
  const summary = houdiniSummary(tool);
  const pending = tool.result === undefined;
  const script = scriptOf(tool);
  return (
    <details className={`tool${tool.isError ? " error" : ""}${pending ? " pending" : ""}`} data-testid="tool-card" open={script !== undefined}>
      <summary>
        <span className="tool-name">{label}</span>
        {summary && <span className="tool-summary">{summary}</span>}
        <span className="tool-status">{pending ? "…" : tool.isError ? "error" : `${tool.durationMs} ms`}</span>
      </summary>
      {script !== undefined && <CodeBlock code={script.code} language={script.language} />}
      {script === undefined && <pre className="tool-args">{JSON.stringify(tool.args, null, 2)}</pre>}
      {!pending && <pre className="tool-result">{tool.result}</pre>}
    </details>
  );
}
