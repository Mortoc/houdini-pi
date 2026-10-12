/**
 * The Houdini workflow as a pi extension.
 *
 * Loaded two ways with the same code: by the houdini-pi sidecar through
 * `createHoudiniExtension`, and by the pi CLI through the default export,
 * which reads HOUDINI_PI_PORT (default 8100) and works on whichever Houdini
 * answers there.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { BridgeUnreachable, HoudiniBridge } from "./bridge.js";
import { Compactor, MemoryStore, type MemoryBridge } from "./memory.js";

export interface SceneContext {
  hip: string | null;
  current_network: string | null;
  selected: { path: string; type: string }[];
  display_node: string | null;
  frame: number;
}

export interface HoudiniExtensionBridge extends MemoryBridge {
  isUp(): Promise<boolean>;
  execute(command: string, params?: Record<string, unknown>): Promise<unknown>;
}

export interface HoudiniExtensionOptions {
  bridge: HoudiniExtensionBridge;
  houdiniPort: number;
  /** Whether pi's file tools (bash, edit, write) may run this turn. Default: never. */
  fileToolsEnabled?: () => boolean;
  /** One-shot condense call for memory compaction. Omit to disable compaction. */
  condense?: (prompt: string, ctx: ExtensionContext) => Promise<string>;
  /** Reports compaction results and failures to the host (the pane, or the terminal). */
  onCompaction?: (report: { before: number; after: number } | { error: string }) => void;
  /** Pin of the fxhoudinimcp MCP server to run with uvx. */
  fxhoudinimcpRef?: string;
  /** Skip MCP registration (the host already provides the server). */
  registerMcp?: boolean;
}

export const FILE_TOOLS = ["bash", "powershell", "edit", "write"] as const;

export const FXHOUDINIMCP_REF = "git+https://github.com/healkeiser/fxhoudinimcp@v2.25.0";

/** Tools the model sees directly; the rest of fxhoudinimcp's ~210 reach it through codemode. */
export const DIRECT_TOOLS = [
  "get_scene_info",
  "get_scene_summary",
  "get_selection",
  "set_selection",
  "explain_node",
  "get_node_card",
  "get_node_info",
  "find_nodes",
  "list_children",
  "create_node",
  "connect_nodes",
  "delete_node",
  "rename_node",
  "build_network",
  "layout_children",
  "get_parameters",
  "set_parameter",
  "set_parameters",
  "set_expression",
  "create_wrangle",
  "get_wrangle_code",
  "set_wrangle_code",
  "validate_vex",
  "capture_screenshot",
  "set_current_network",
  "get_node_errors_detailed",
  "execute_python",
  "search_help",
];

export function mcpServerConfig(houdiniPort: number, ref = FXHOUDINIMCP_REF) {
  return {
    command: "uvx",
    args: ["--from", ref, "fxhoudinimcp"],
    env: { HOUDINI_PORT: String(houdiniPort) },
    exposure: "codemode" as const,
    toolExposure: Object.fromEntries(DIRECT_TOOLS.map((tool) => [tool, "direct" as const])),
    description: "The live Houdini session: nodes, parameters, VEX, viewport screenshots.",
  };
}

export function contextBlock(scene: SceneContext, memory: string): string {
  const selected = scene.selected.length === 0 ? "(nothing selected)" : scene.selected.map((n) => `${n.path} (${n.type})`).join(", ");
  const lines = [
    "## Houdini scene right now",
    `- hip: ${scene.hip ?? "(untitled)"}`,
    `- current network: ${scene.current_network ?? "(none)"}`,
    `- selected: ${selected}`,
    `- display node: ${scene.display_node ?? "(none)"}`,
    `- frame: ${scene.frame}`,
  ];
  const has_memory = memory.trim().length > 0;
  if (has_memory) {
    lines.push("", `## Project memory for ${scene.hip ?? "this hip"}`, "", memory.trim());
  }
  return lines.join("\n");
}

export function createHoudiniExtension(options: HoudiniExtensionOptions) {
  const { bridge } = options;
  const memory = new MemoryStore(bridge);
  const fileToolsEnabled = options.fileToolsEnabled ?? (() => false);
  const compactor = options.condense === undefined ? undefined : new Compactor({ condense: (prompt) => options.condense!(prompt, currentCtx!) });
  let currentCtx: ExtensionContext | undefined;
  let turnOpen = false;

  const endTurn = async () => {
    if (!turnOpen) return;
    turnOpen = false;
    await bridge.runHelper("end_turn");
  };

  return function houdiniExtension(pi: ExtensionAPI) {
    if (options.registerMcp !== false) {
      pi.registerMcpServer("fxhoudini", mcpServerConfig(options.houdiniPort, options.fxhoudinimcpRef));
    }

    pi.on("before_agent_start", async (event, ctx) => {
      currentCtx = ctx;
      const [scene, memoryText] = await Promise.all([bridge.runHelper<SceneContext>("scene_context"), memory.read()]);
      await bridge.runHelper("begin_turn", { label: `houdini-pi: ${event.prompt.slice(0, 60)}` });
      turnOpen = true;
      return { message: { customType: "houdini-pi-context", content: contextBlock(scene, memoryText), display: false } };
    });

    pi.on("tool_call", (event) => {
      const is_file_tool = (FILE_TOOLS as readonly string[]).includes(event.toolName);
      if (is_file_tool && !fileToolsEnabled()) {
        return { block: true, reason: `${event.toolName} is off in houdini-pi; work on the scene through the Houdini tools, or enable file tools in the pane.` };
      }
      return undefined;
    });

    pi.on("agent_settled", async (_event, ctx) => {
      currentCtx = ctx;
      try {
        await endTurn();
      } finally {
        if (compactor !== undefined) {
          try {
            const report = await compactor.maybeCompact(memory);
            if (report !== null) options.onCompaction?.(report);
          } catch (error) {
            options.onCompaction?.({ error: (error as Error).message });
          }
        }
      }
    });

    pi.on("session_shutdown", async () => {
      await endTurn().catch(() => undefined);
    });

    pi.registerTool({
      name: "memory_read",
      label: "Read project memory",
      description: "Read the curated project memory stored in this .hip file.",
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: (await memory.read()) || "(empty)" }], details: {} }),
    });

    pi.registerTool({
      name: "memory_append",
      label: "Append to project memory",
      description: "Append a note under a section of the project memory stored in this .hip. Record decisions, naming conventions and node roles, never narration.",
      parameters: Type.Object({
        section: Type.String({ description: "Section heading, e.g. Conventions, Decisions, Node roles" }),
        text: Type.String({ description: "One or more markdown bullets" }),
      }),
      execute: async (_id, params) => {
        const next = await memory.append(params.section, params.text);
        return { content: [{ type: "text", text: `memory is now ${next.length} chars` }], details: {} };
      },
    });

    pi.registerTool({
      name: "memory_replace",
      label: "Replace project memory",
      description: "Replace the whole project memory stored in this .hip. The previous text stays recoverable once.",
      parameters: Type.Object({ text: Type.String() }),
      execute: async (_id, params) => {
        await memory.replace(params.text);
        return { content: [{ type: "text", text: "memory replaced" }], details: {} };
      },
    });

    pi.registerCommand("scene", {
      description: "Show what houdini-pi knows about the current Houdini scene",
      handler: async (_args, ctx) => {
        const scene = await bridge.runHelper<SceneContext>("scene_context");
        ctx.ui.notify(contextBlock(scene, ""), "info");
      },
    });

    pi.registerCommand("memory", {
      description: "Show the project memory stored in this .hip",
      handler: async (_args, ctx) => {
        ctx.ui.notify((await memory.read()) || "(empty)", "info");
      },
    });

    pi.registerCommand("undo-turn", {
      description: "Undo the last agent turn in Houdini",
      handler: async (_args, ctx) => {
        await bridge.execute("scene.undo");
        ctx.ui.notify("undid the last turn", "info");
      },
    });
  };
}

function portFromEnv(): number {
  const raw = process.env["HOUDINI_PI_PORT"] ?? "8100";
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`HOUDINI_PI_PORT=${raw} is not a port`);
  return port;
}

/** CLI entry: `pi install git:github.com/Mortoc/houdini-pi` loads this. */
export default function houdiniPiCliExtension(pi: ExtensionAPI) {
  const port = portFromEnv();
  const bridge = new HoudiniBridge(port);
  const extension = createHoudiniExtension({
    bridge,
    houdiniPort: port,
    fileToolsEnabled: () => process.env["HOUDINI_PI_FILE_TOOLS"] === "1",
    onCompaction: (report) => {
      if ("error" in report) console.error(`[houdini-pi] memory compaction failed: ${report.error}`);
    },
  });
  extension(pi);
  pi.on("session_start", async (_event, ctx) => {
    const up = await bridge.isUp();
    if (!up) ctx.ui.notify(`houdini-pi: no Houdini bridge on 127.0.0.1:${port}; tools will fail until Houdini is up`, "warning");
  });
}

export { BridgeUnreachable };
