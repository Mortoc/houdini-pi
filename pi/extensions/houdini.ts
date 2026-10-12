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
import { readFile, unlink } from "node:fs/promises";
import { FollowQueue } from "./follow-queue.js";
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

export interface RenderedCop {
  path: string;
  node: string;
  frame: number;
}

export interface FollowReport {
  followed: string | null;
  panes: number;
  categories?: Record<string, string>;
}

/** Longest edge of a COP preview. Enough to see wiring mistakes, small enough to be cheap in context. */
export const COP_PREVIEW_SIZE = 256;

export const COP_NUDGE =
  "You changed Copernicus (COP) nodes this turn but have not looked at the result. Call inspect_cop on the network's output node now, fix what the image shows is wrong, then finish. Do not summarise.";

export interface HoudiniExtensionOptions {
  bridge: HoudiniExtensionBridge;
  houdiniPort: number;
  /** Whether pi's file tools (bash, edit, write) may run this turn. Default: never. */
  fileToolsEnabled?: () => boolean;
  /** Whether the scene follows the agent (selection + linked pane tabs). Default: always. */
  followNodes?: () => boolean;
  /** Minimum time each followed selection stays on screen. Default 500 ms. */
  followMinGapMs?: number;
  /** Reports the autosave backup taken before the first modifying tool call of a turn, why it was skipped, or its failure. */
  onBackup?: (report: { path: string } | { skipped: string } | { error: string }) => void;
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

const READ_ONLY_PREFIXES = ["get_", "list_", "find_", "search_", "explain_", "capture_", "inspect_", "compare_", "sample_", "validate_", "evaluate_", "describe_", "verify_", "render_", "memory_read"];

/** Whether a tool can change the scene. Reads are named for what they return; everything else is assumed to write. */
export function canModifyScene(toolName: string): boolean {
  const bare = toolName.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "");
  const is_houdini = toolName.startsWith("mcp__fxhoudini__");
  const is_memory = toolName.startsWith("memory_");
  const is_read = READ_ONLY_PREFIXES.some((prefix) => bare.startsWith(prefix));
  const is_codemode = toolName === "codemode";
  return (is_houdini && !is_read) || is_codemode || (!is_memory && !is_houdini && !is_read && (FILE_TOOLS as readonly string[]).includes(toolName));
}

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
  "set_current_network",
  "get_node_errors_detailed",
  "execute_python",
  "search_help",
];

/** The installer pins the uvx it validated in HOUDINI_PI_UVX: Houdini's PATH is not the shell's. */
export function uvxCommand(env: NodeJS.ProcessEnv = process.env): string {
  return env["HOUDINI_PI_UVX"] || "uvx";
}

const NODE_PATH = /^\/[A-Za-z0-9_][A-Za-z0-9_\/.:-]*$/;
const PATH_KEYS = new Set(["node_path", "path", "parent_path", "parent", "node", "new_path", "target_path", "node_paths", "paths", "nodes", "created", "selected"]);

/** Node paths a tool call touched, from its arguments and its result, in order of appearance. */
export function nodePathsFrom(args: unknown, result: unknown): string[] {
  const found: string[] = [];
  const visit = (value: unknown, keyed: boolean, depth: number) => {
    if (depth > 6) return;
    if (typeof value === "string") {
      if (keyed && NODE_PATH.test(value) && !found.includes(value)) found.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, keyed, depth + 1);
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const [key, item] of Object.entries(value)) visit(item, PATH_KEYS.has(key), depth + 1);
    }
  };
  visit(args, false, 0);
  let parsed: unknown = result;
  if (typeof result === "string") {
    try {
      parsed = JSON.parse(result);
    } catch {
      parsed = undefined;
    }
  }
  visit(parsed, false, 0);
  return found.slice(0, 20);
}

export function mcpServerConfig(houdiniPort: number, ref = FXHOUDINIMCP_REF, command = uvxCommand()) {
  return {
    command,
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
  let backedUpThisTurn = false;
  const argsByCall = new Map<string, unknown>();
  let copDirty = false;
  let nudges = 0;
  const followQueue = new FollowQueue<FollowReport>((paths) => bridge.runHelper<FollowReport>("follow_nodes", { paths }), options.followMinGapMs ?? 500);

  // Previews are read once and deleted: nothing accumulates on disk, and the
  // model never sees a path it could be tempted to re-read with execute_python.
  const consumePng = async (path: string): Promise<string> => {
    const png = await readFile(path);
    await unlink(path).catch(() => undefined);
    return png.toString("base64");
  };

  const inspectCop = async (nodePath: string, maxSize = COP_PREVIEW_SIZE) => {
    const rendered = await bridge.runHelper<RenderedCop>("render_cop", { node_path: nodePath, max_size: maxSize });
    const data = await consumePng(rendered.path);
    copDirty = false;
    return { rendered, data };
  };

  const inspectViewport = async (paneName?: string) => {
    const captured = await bridge.runHelper<{ path: string; pane: string | null; frame: number }>("capture_viewport", paneName ? { pane_name: paneName } : {});
    return { captured, data: await consumePng(captured.path) };
  };

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
      backedUpThisTurn = false;
      copDirty = false;
      nudges = 0;
      return { message: { customType: "houdini-pi-context", content: contextBlock(scene, memoryText), display: false } };
    });

    pi.on("tool_call", async (event) => {
      const is_file_tool = (FILE_TOOLS as readonly string[]).includes(event.toolName);
      if (is_file_tool && !fileToolsEnabled()) {
        return { block: true, reason: `${event.toolName} is off in houdini-pi; work on the scene through the Houdini tools.` };
      }
      const needs_backup = !backedUpThisTurn && canModifyScene(event.toolName);
      if (needs_backup) {
        // Once per turn, before the first call that can touch the scene: a
        // Houdini autosave backup the artist can fall back to beyond undo.
        backedUpThisTurn = true;
        try {
          const report = await bridge.runHelper<{ path: string } | { skipped: string }>("backup_scene");
          options.onBackup?.(report);
        } catch (error) {
          options.onBackup?.({ error: (error as Error).message });
        }
      }
      return undefined;
    });

    pi.on("tool_execution_start", (event) => {
      argsByCall.set(event.toolCallId, event.args);
    });

    pi.on("tool_execution_end", async (event) => {
      const args = argsByCall.get(event.toolCallId);
      argsByCall.delete(event.toolCallId);
      const is_houdini = event.toolName.startsWith("mcp__fxhoudini__");
      const wants_follow = is_houdini && !event.isError && (options.followNodes?.() ?? true);
      if (!wants_follow) return;
      const paths = nodePathsFrom(args, (event.result as { content?: unknown })?.content ?? event.result);
      if (paths.length === 0) return;
      // Queued, not awaited: the agent keeps working while selections are
      // shown 500 ms apart. A failure is a convenience lost, never a turn lost.
      const modifies = canModifyScene(event.toolName);
      followQueue
        .enqueue(paths)
        .then((report) => {
          const touched_cop = modifies && Object.values(report.categories ?? {}).includes("Cop");
          if (touched_cop) copDirty = true;
        })
        .catch((error) => options.onBackup?.({ error: `follow failed: ${(error as Error).message}` }));
    });

    pi.on("agent_before_settle", async (event) => {
      await followQueue.idle();
      const must_look = copDirty && nudges < 2 && event.context.canContinue;
      if (!must_look) return undefined;
      nudges++;
      return {
        continue: true,
        entries: [{ type: "custom_message", customType: "houdini-pi-nudge", content: COP_NUDGE, display: true }],
      };
    });

    pi.registerTool({
      name: "inspect_cop",
      label: "Inspect a COP network's image",
      description:
        "Render a Copernicus (COP) node to an image and look at it. Call this after every change to a COP network, on its output node, before you finish. The image is returned to you.",
      promptSnippet: "Render a COP node and see the image",
      promptGuidelines: ["After changing anything in a Copernicus network, call inspect_cop on its output node and check the image before finishing."],
      parameters: Type.Object({
        node_path: Type.String({ description: "Absolute path of the COP node to render, usually the network's output" }),
        max_size: Type.Optional(Type.Number({ description: "Longest edge in pixels, default 256" })),
      }),
      execute: async (_id, params) => {
        const { rendered, data } = await inspectCop(params.node_path, params.max_size ?? COP_PREVIEW_SIZE);
        return {
          content: [
            { type: "image", data, mimeType: "image/png" },
            { type: "text", text: `Rendered ${rendered.node} at frame ${rendered.frame}. The image above is what the network produces; judge it, do not re-read it.` },
          ],
          details: { node: rendered.node },
        };
      },
    });

    pi.registerTool({
      name: "inspect_viewport",
      label: "Look at the viewport",
      description:
        "Screenshot the scene viewer (or a named pane tab) and look at it. Use this to check geometry, materials and lights after changing them. The image is returned to you.",
      promptSnippet: "Screenshot the viewport and see it",
      parameters: Type.Object({
        pane_name: Type.Optional(Type.String({ description: "Pane tab name; default: the first scene viewer" })),
      }),
      execute: async (_id, params) => {
        const { captured, data } = await inspectViewport(params.pane_name);
        return {
          content: [
            { type: "image", data, mimeType: "image/png" },
            { type: "text", text: `Viewport at frame ${captured.frame}. The image above is in your context; judge it, do not re-read it.` },
          ],
          details: { pane: captured.pane },
        };
      },
    });

    pi.registerCommand("inspect-cop", {
      description: "Render a COP node to an image and show it to the agent: /inspect-cop /obj/copnet/out",
      handler: async (args, ctx) => {
        const nodePath = args.trim();
        if (nodePath.length === 0) {
          ctx.ui.notify("usage: /inspect-cop /path/to/cop/node", "warning");
          return;
        }
        const { rendered, data } = await inspectCop(nodePath);
        pi.sendMessage(
          {
            customType: "houdini-pi-inspect",
            content: [
              { type: "image", data, mimeType: "image/png" },
              { type: "text", text: `The artist asked you to look at ${rendered.node}. Describe what is wrong, if anything, in one line.` },
            ],
            display: true,
          },
          { triggerTurn: true },
        );
      },
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
