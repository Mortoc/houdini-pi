import type { ToolCall } from "../state.js";

function houdiniSummary(tool: ToolCall): string | undefined {
  const is_houdini = tool.toolName.startsWith("mcp__fxhoudini__");
  if (!is_houdini) return undefined;
  const args = (tool.args ?? {}) as Record<string, unknown>;
  const parts = [args["node_path"], args["parm_name"], args["node_type"], args["name"]].filter((v) => typeof v === "string") as string[];
  return parts.join(" · ");
}

export function ToolCard({ tool }: { tool: ToolCall }) {
  const label = tool.toolName.replace(/^mcp__fxhoudini__/, "houdini: ");
  const summary = houdiniSummary(tool);
  const pending = tool.result === undefined;
  return (
    <details className={`tool${tool.isError ? " error" : ""}${pending ? " pending" : ""}`} data-testid="tool-card">
      <summary>
        <span className="tool-name">{label}</span>
        {summary && <span className="tool-summary">{summary}</span>}
        <span className="tool-status">{pending ? "…" : tool.isError ? "error" : `${tool.durationMs} ms`}</span>
      </summary>
      <pre className="tool-args">{JSON.stringify(tool.args, null, 2)}</pre>
      {!pending && <pre className="tool-result">{tool.result}</pre>}
    </details>
  );
}
