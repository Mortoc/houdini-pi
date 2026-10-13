import { describe, expect, it } from "vitest";
import { canModifyScene, contextBlock, COP_NUDGE, nodePathsFrom, createHoudiniExtension, DIRECT_TOOLS, mcpServerConfig, uvxCommand, type HoudiniExtensionBridge, type SceneContext } from "../extensions/houdini.js";

type Handler = (event: any, ctx: any) => any;

/** Records what an extension registers; replays events to it. */
class FakeExtensionAPI {
  handlers = new Map<string, Handler[]>();
  tools = new Map<string, any>();
  commands = new Map<string, any>();
  mcp = new Map<string, any>();
  on(event: string, handler: Handler) { (this.handlers.get(event) ?? this.handlers.set(event, []).get(event)!).push(handler); return () => {}; }
  registerTool(tool: any) { this.tools.set(tool.name, tool); }
  registerCommand(name: string, options: any) { this.commands.set(name, options); }
  registerMcpServer(name: string, config: any) { this.mcp.set(name, config); }
  async fire(event: string, payload: any = {}, ctx: any = fakeCtx()) {
    const results = [];
    for (const handler of this.handlers.get(event) ?? []) results.push(await handler({ type: event, ...payload }, ctx));
    return results;
  }
}

function fakeCtx() {
  const notices: string[] = [];
  return { notices, ui: { notify: (text: string) => notices.push(text) }, hasUI: true, mode: "rpc" };
}

const scene: SceneContext = { hip: "/scenes/rock.hip", current_network: "/obj/geo1", selected: [{ path: "/obj/geo1/wire1", type: "wire" }], display_node: "/obj/geo1/OUT", frame: 12 };

class FakeBridge implements HoudiniExtensionBridge {
  calls: { name: string; kwargs: Record<string, unknown> }[] = [];
  executed: string[] = [];
  backups = 0;
  followed: string[][] = [];
  renders: string[] = [];
  renderFile = "/nonexistent.png";
  memory = "## Conventions\n\n- metres\n";
  prev: string | null = null;
  projectMemory = "## Pipeline\n\n- EXRs only\n";
  projectPrev: string | null = null;
  projectAvailable = true;
  up = true;
  failBeginTurn = false;
  async isUp() { return this.up; }
  async execute(command: string) { this.executed.push(command); return {}; }
  async runHelper<T>(name: string, kwargs: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ name, kwargs });
    switch (name) {
      case "scene_context": return scene as T;
      case "memory_read": return { text: this.memory, prev: this.prev } as T;
      case "memory_write": this.memory = kwargs["text"] as string; this.prev = kwargs["prev"] as string | null; return undefined as T;
      case "project_memory_read": return { available: this.projectAvailable, text: this.projectMemory, prev: this.projectPrev } as T;
      case "project_memory_write": this.projectMemory = kwargs["text"] as string; this.projectPrev = kwargs["prev"] as string | null; return undefined as T;
      case "begin_turn": if (this.failBeginTurn) throw new Error("hou exploded"); return undefined as T;
      case "end_turn": return undefined as T;
      case "backup_scene": this.backups++; return { path: `/bak/${this.backups}.hip` } as T;
      case "follow_nodes": {
        const paths = kwargs["paths"] as string[];
        this.followed.push(paths);
        const categories = Object.fromEntries(paths.map((p) => [p, p.includes("copnet") ? "Cop" : "Object"]));
        return { followed: paths.at(-1), panes: 1, categories } as T;
      }
      case "render_cop": {
        this.renders.push(kwargs["node_path"] as string);
        return { path: this.renderFile, node: kwargs["node_path"], frame: 1 } as T;
      }
      case "validate_paths": {
        const paths = kwargs["paths"] as string[];
        return { kinds: Object.fromEntries(paths.map((p) => [p, p.endsWith("/radius") ? "parm" : p.includes("nope") ? null : "node"])) } as T;
      }
      case "capture_viewport": {
        this.renders.push(`viewport:${kwargs["pane_name"] ?? ""}`);
        return { path: this.renderFile, pane: kwargs["pane_name"] ?? null, frame: 1 } as T;
      }
    }
    throw new Error(`unexpected helper ${name}`);
  }
  helperNames() { return this.calls.map((c) => c.name); }
}

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ASSETS = mkdtempSync(join(tmpdir(), "houdini-pi-assets-"));
const toolCtx = { sessionManager: { getSessionId: () => "sess-1" } };

function load(bridge: FakeBridge, extra: Partial<Parameters<typeof createHoudiniExtension>[0]> = {}) {
  const pi = new FakeExtensionAPI();
  createHoudiniExtension({ bridge, houdiniPort: 8103, followMinGapMs: 0, assetsDir: ASSETS, ...extra })(pi as any);
  return pi;
}

const flush = () => new Promise((r) => setTimeout(r, 5));

describe("houdini extension", () => {
  it("registers fxhoudini as an MCP server on the given Houdini port with curated direct tools", () => {
    const pi = load(new FakeBridge());
    const config = pi.mcp.get("fxhoudini");
    expect(config.command).toBe("uvx");
    expect(config.args).toEqual(["--from", expect.stringContaining("fxhoudinimcp@v"), "fxhoudinimcp"]);
    expect(config.env).toEqual({ HOUDINI_PORT: "8103", FXHOUDINIMCP_AUTO_LAYOUT: "0" });
    expect(config.exposure).toBe("codemode");
    expect(config.toolExposure["set_parameter"]).toBe("direct");
    expect(Object.keys(config.toolExposure)).toHaveLength(DIRECT_TOOLS.length);
    expect(mcpServerConfig(8100).env).toEqual({ HOUDINI_PORT: "8100", FXHOUDINIMCP_AUTO_LAYOUT: "0" });
    expect(mcpServerConfig(8100, undefined, undefined, true).env).toEqual({ HOUDINI_PORT: "8100", FXHOUDINIMCP_AUTO_LAYOUT: "1" });
    expect(uvxCommand({})).toBe("uvx");
    expect(uvxCommand({ HOUDINI_PI_UVX: "/nix/store/x/bin/uvx" })).toBe("/nix/store/x/bin/uvx");
    expect(mcpServerConfig(8100, undefined, "/x/uvx").command).toBe("/x/uvx");
  });

  it("skips MCP registration when the host provides the server", () => {
    expect(load(new FakeBridge(), { registerMcp: false }).mcp.size).toBe(0);
  });

  it("injects scene context and memory, and opens an undo group, before the agent starts", async () => {
    const bridge = new FakeBridge();
    const pi = load(bridge);
    const [result] = await pi.fire("before_agent_start", { prompt: "make the wires thinner", systemPrompt: "", systemPromptOptions: {} });
    expect(result.message.customType).toBe("houdini-pi-context");
    expect(result.message.display).toBe(false);
    expect(result.message.content).toContain("/obj/geo1/wire1 (wire)");
    expect(result.message.content).toContain("## Hip memory for /scenes/rock.hip");
    expect(result.message.content).toContain("- metres");
    const begin = bridge.calls.find((c) => c.name === "begin_turn");
    expect(begin?.kwargs).toEqual({ label: "houdini-pi: make the wires thinner" });
  });

  it("closes the undo group once when the agent settles, and not again on shutdown", async () => {
    const bridge = new FakeBridge();
    const pi = load(bridge);
    await pi.fire("before_agent_start", { prompt: "x", systemPromptOptions: {} });
    await pi.fire("agent_settled", { aborted: false });
    await pi.fire("session_shutdown", { reason: "quit" });
    expect(bridge.helperNames().filter((n) => n === "end_turn")).toHaveLength(1);
    await pi.fire("agent_settled", { aborted: true });
    expect(bridge.helperNames().filter((n) => n === "end_turn")).toHaveLength(1);
  });

  it("does not leave a group open when begin_turn fails", async () => {
    const bridge = new FakeBridge();
    bridge.failBeginTurn = true;
    const pi = load(bridge);
    await expect(pi.fire("before_agent_start", { prompt: "x", systemPromptOptions: {} })).rejects.toThrow("hou exploded");
    await pi.fire("agent_settled", { aborted: true });
    expect(bridge.helperNames()).not.toContain("end_turn");
  });

  it("blocks file tools unless the host enables them, and never blocks Houdini tools", async () => {
    let enabled = false;
    const pi = load(new FakeBridge(), { fileToolsEnabled: () => enabled });
    const [blocked] = await pi.fire("tool_call", { toolName: "bash", toolCallId: "1", input: {} });
    expect(blocked).toMatchObject({ block: true, reason: expect.stringContaining("Houdini tools") });
    const [houdini] = await pi.fire("tool_call", { toolName: "mcp__fxhoudini__set_parameter", toolCallId: "2", input: {} });
    expect(houdini).toBeUndefined();
    enabled = true;
    const [allowed] = await pi.fire("tool_call", { toolName: "edit", toolCallId: "3", input: {} });
    expect(allowed).toBeUndefined();
  });

  it("knows which tools can change the scene", () => {
    expect(canModifyScene("mcp__fxhoudini__get_scene_info")).toBe(false);
    expect(canModifyScene("mcp__fxhoudini__capture_screenshot")).toBe(false);
    expect(canModifyScene("mcp__fxhoudini__set_parameter")).toBe(true);
    expect(canModifyScene("mcp__fxhoudini__create_node")).toBe(true);
    expect(canModifyScene("mcp__fxhoudini__execute_python")).toBe(true);
    expect(canModifyScene("codemode")).toBe(true);
    expect(canModifyScene("memory_append")).toBe(false);
    expect(canModifyScene("read")).toBe(false);
    expect(canModifyScene("bash")).toBe(true);
  });

  it("backs the scene up once per turn, before the first modifying tool call", async () => {
    const bridge = new FakeBridge();
    const reports: unknown[] = [];
    const pi = load(bridge, { onBackup: (r) => reports.push(r) });
    await pi.fire("before_agent_start", { prompt: "x", systemPromptOptions: {} });
    await pi.fire("tool_call", { toolName: "mcp__fxhoudini__get_scene_info", toolCallId: "1", input: {} });
    expect(bridge.backups).toBe(0);
    await pi.fire("tool_call", { toolName: "mcp__fxhoudini__create_node", toolCallId: "2", input: {} });
    await pi.fire("tool_call", { toolName: "mcp__fxhoudini__set_parameter", toolCallId: "3", input: {} });
    expect(bridge.backups).toBe(1);
    expect(reports).toEqual([{ path: "/bak/1.hip" }]);
    await pi.fire("agent_settled", { aborted: false });
    await pi.fire("before_agent_start", { prompt: "y", systemPromptOptions: {} });
    await pi.fire("tool_call", { toolName: "mcp__fxhoudini__delete_node", toolCallId: "4", input: {} });
    expect(bridge.backups).toBe(2);
  });

  it("extracts node paths from tool args and results, keyed fields only", () => {
    expect(nodePathsFrom({ node_path: "/obj/geo1", value: "/not/a/key" }, undefined)).toEqual(["/obj/geo1"]);
    expect(nodePathsFrom({ parent_path: "/obj" }, JSON.stringify({ created: [{ path: "/obj/box1" }, { path: "/obj/box2" }] }))).toEqual(["/obj", "/obj/box1", "/obj/box2"]);
    expect(nodePathsFrom({ node_paths: ["/obj/a", "/obj/a"] }, "not json")).toEqual(["/obj/a"]);
    expect(nodePathsFrom({ code: "/usr/bin/python" }, [{ type: "text", text: JSON.stringify({ node: "/obj/c" }) }])).toEqual([]);
    expect(nodePathsFrom({ path: "relative/path" }, undefined)).toEqual([]);
  });

  it("makes the scene follow Houdini tool calls that touched nodes", async () => {
    const bridge = new FakeBridge();
    const pi = load(bridge);
    const call = async (id: string, toolName: string, args: unknown, result: unknown, isError = false) => {
      await pi.fire("tool_execution_start", { toolCallId: id, toolName, args });
      await pi.fire("tool_execution_end", { toolCallId: id, toolName, result, isError });
    };
    await call("1", "mcp__fxhoudini__get_node_card", { node_path: "/obj/geo1" }, { content: [{ type: "text", text: "{}" }] });
    await call("2", "mcp__fxhoudini__create_node", { parent_path: "/obj" }, JSON.stringify({ path: "/obj/envlight1" }));
    await call("3", "mcp__fxhoudini__get_scene_info", {}, "{}");
    await call("4", "mcp__fxhoudini__delete_node", { node_path: "/obj/x" }, "boom", true);
    await call("5", "read", { path: "/etc/hosts" }, "");
    await flush();
    expect(bridge.followed).toEqual([["/obj/geo1"], ["/obj", "/obj/envlight1"]]);
    const quiet = new FakeBridge();
    const off = load(quiet, { followNodes: () => false });
    await off.fire("tool_execution_start", { toolCallId: "6", toolName: "mcp__fxhoudini__get_node_card", args: { node_path: "/obj/geo1" } });
    await off.fire("tool_execution_end", { toolCallId: "6", toolName: "mcp__fxhoudini__get_node_card", result: "{}", isError: false });
    await flush();
    expect(quiet.followed).toEqual([]);
  });

  it("spaces follow calls by the configured gap", async () => {
    const bridge = new FakeBridge();
    const pi = load(bridge, { followMinGapMs: 30 });
    const started = Date.now();
    for (const id of ["1", "2", "3"]) {
      await pi.fire("tool_execution_start", { toolCallId: id, toolName: "mcp__fxhoudini__get_node_card", args: { node_path: `/obj/n${id}` } });
      await pi.fire("tool_execution_end", { toolCallId: id, toolName: "mcp__fxhoudini__get_node_card", result: "{}", isError: false });
    }
    await pi.fire("agent_before_settle", { context: { canContinue: true }, entries: [], continue: false });
    expect(bridge.followed).toEqual([["/obj/n1"], ["/obj/n2"], ["/obj/n3"]]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
  });

  it("nudges the agent to inspect a COP network it changed, at most twice, until it does", async () => {
    const bridge = new FakeBridge();
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const png = join(mkdtempSync(join(tmpdir(), "houdini-pi-png-")), "out.png");
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    bridge.renderFile = png;
    const pi = load(bridge);
    const settle = () => pi.fire("agent_before_settle", { context: { canContinue: true }, entries: [], continue: false });
    const modify = async (id: string, toolName: string, args: unknown) => {
      await pi.fire("tool_execution_start", { toolCallId: id, toolName, args });
      await pi.fire("tool_execution_end", { toolCallId: id, toolName, result: "{}", isError: false });
    };

    await pi.fire("before_agent_start", { prompt: "x", systemPromptOptions: {} });
    await modify("1", "mcp__fxhoudini__set_parameter", { node_path: "/obj/geo1" });
    expect((await settle())[0]).toBeUndefined();

    await modify("2", "mcp__fxhoudini__create_node", { parent_path: "/obj/hex_copnet" });
    const [nudge] = await settle();
    expect(nudge).toEqual({ continue: true, entries: [{ type: "custom_message", customType: "houdini-pi-nudge", content: COP_NUDGE, display: true }] });
    expect((await settle())[0]).toMatchObject({ continue: true });
    expect((await settle())[0]).toBeUndefined();

    await modify("3", "mcp__fxhoudini__set_parameter", { node_path: "/obj/hex_copnet/blend" });
    const result = await pi.tools.get("inspect_cop").execute("call/1", { node_path: "/obj/hex_copnet/color_out" }, undefined, undefined, toolCtx);
    expect(bridge.renders).toEqual(["/obj/hex_copnet/color_out"]);
    expect(result.content[0]).toEqual({ type: "image", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"), mimeType: "image/png" });
    expect(result.content[1].text).toContain("Rendered /obj/hex_copnet/color_out");
    expect(result.content[1].text).not.toContain(png);
    expect(result.details).toEqual({ node: "/obj/hex_copnet/color_out", asset: "sess-1/call_1.png" });
    const { existsSync, writeFileSync: write2, readFileSync } = await import("node:fs");
    expect(existsSync(png), "the temp file moved into the conversation's assets").toBe(false);
    expect(readFileSync(join(ASSETS, "sess-1", "call_1.png"))).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    write2(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await pi.fire("before_agent_start", { prompt: "y", systemPromptOptions: {} });
    await modify("4", "mcp__fxhoudini__set_parameter", { node_path: "/obj/hex_copnet/blend" });
    write2(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await pi.tools.get("inspect_cop").execute("d", { node_path: "/obj/hex_copnet/color_out" }, undefined, undefined, toolCtx);
    expect((await settle())[0]).toBeUndefined();

    await modify("5", "mcp__fxhoudini__get_cop_info", { node_path: "/obj/hex_copnet/color_out" });
    expect((await settle())[0]).toBeUndefined();
  });

  it("inspect_viewport returns the screenshot inline and keeps it with the conversation", async () => {
    const bridge = new FakeBridge();
    const { writeFileSync, existsSync } = await import("node:fs");
    const png = join(mkdtempSync(join(tmpdir(), "houdini-pi-png-")), "viewport.png");
    writeFileSync(png, Buffer.from([1, 2, 3]));
    bridge.renderFile = png;
    const pi = load(bridge);
    const result = await pi.tools.get("inspect_viewport").execute("v", { pane_name: "scene1" }, undefined, undefined, toolCtx);
    expect(bridge.renders).toEqual(["viewport:scene1"]);
    expect(result.content[0]).toEqual({ type: "image", data: Buffer.from([1, 2, 3]).toString("base64"), mimeType: "image/png" });
    expect(result.content[1].text).not.toContain(png);
    expect(result.details).toEqual({ pane: "scene1", asset: "sess-1/v.png" });
    expect(existsSync(png)).toBe(false);
    expect(existsSync(join(ASSETS, "sess-1", "v.png"))).toBe(true);
  });

  it("present_answer validates links against the scene and satisfies the question nudge", async () => {
    const bridge = new FakeBridge();
    const pi = load(bridge);
    const settle = () => pi.fire("agent_before_settle", { context: { canContinue: true }, entries: [], continue: false });
    await pi.fire("before_agent_start", { prompt: "How do I thin the wires?", systemPromptOptions: {} });
    const [nudge] = await settle();
    expect(nudge).toMatchObject({ continue: true, entries: [{ customType: "houdini-pi-nudge", content: expect.stringContaining("present_answer") }] });
    expect((await settle())[0]).toBeUndefined();

    const md = "1. Select [wire](houdini://select?path=/obj/geo1/wire1), set [radius](houdini://parm?path=/obj/geo1/wire1/radius). Not: [x](houdini://select?path=/obj/nope) [y](houdini://parm?path=/obj/geo1) [z](houdini://select?path=/obj/geo1/wire1/radius)";
    const result = await pi.tools.get("present_answer").execute("a1", { markdown: md }, undefined, undefined, {});
    expect(result.details.answer.markdown).toBe(md);
    expect(result.details.answer.invalid).toEqual({
      "houdini://select?path=/obj/nope": "nothing at /obj/nope",
      "houdini://parm?path=/obj/geo1": "/obj/geo1 is a node, not a parameter",
      "houdini://select?path=/obj/geo1/wire1/radius": "/obj/geo1/wire1/radius is a parameter, not a node",
    });
    expect(result.content[0].text).toContain("3 link(s)");

    await pi.fire("before_agent_start", { prompt: "What is an sdfblend?", systemPromptOptions: {} });
    await pi.tools.get("present_answer").execute("a2", { markdown: "A blend." }, undefined, undefined, {});
    expect((await settle())[0]).toBeUndefined();

    await pi.fire("before_agent_start", { prompt: "make the wires thinner", systemPromptOptions: {} });
    expect((await settle())[0]).toBeUndefined();
  });

  it("exposes memory tools that write through the bridge", async () => {
    const bridge = new FakeBridge();
    const pi = load(bridge);
    const append = pi.tools.get("memory_append");
    await append.execute("c1", { section: "Decisions", text: "- wires are 1 cm" }, undefined, undefined, {});
    expect(bridge.memory).toBe("## Conventions\n\n- metres\n\n## Decisions\n\n- wires are 1 cm\n");
    const read = await pi.tools.get("memory_read").execute("c2", {}, undefined, undefined, {});
    expect(read.content[0].text).toContain("wires are 1 cm");
    await pi.tools.get("memory_replace").execute("c3", { text: "fresh" }, undefined, undefined, {});
    expect(bridge).toMatchObject({ memory: "fresh", prev: expect.stringContaining("Decisions") });
  });

  it("compacts after a turn when configured and reports the result", async () => {
    const bridge = new FakeBridge();
    bridge.memory = "- long ".repeat(20_000);
    const reports: unknown[] = [];
    const pi = load(bridge, { condense: async () => "- long", onCompaction: (r) => reports.push(r) });
    await pi.fire("before_agent_start", { prompt: "x", systemPromptOptions: {} });
    await pi.fire("agent_settled", { aborted: false });
    expect(reports).toEqual([{ before: expect.any(Number), after: 2 }]);
    expect(bridge.memory).toBe("- long\n");
  });

  it("reports a failed compaction without touching memory", async () => {
    const bridge = new FakeBridge();
    const big = "- long ".repeat(20_000);
    bridge.memory = big;
    const reports: unknown[] = [];
    const pi = load(bridge, { condense: async () => { throw new Error("quota"); }, onCompaction: (r) => reports.push(r) });
    await pi.fire("agent_settled", { aborted: false });
    expect(reports).toEqual([{ error: "quota" }]);
    expect(bridge.memory).toBe(big);
  });

  it("offers /scene, /memory and /undo-turn", async () => {
    const bridge = new FakeBridge();
    const pi = load(bridge);
    const ctx = fakeCtx();
    await pi.commands.get("scene").handler("", ctx);
    expect(ctx.notices[0]).toContain("current network: /obj/geo1");
    await pi.commands.get("memory").handler("", ctx);
    expect(ctx.notices[1]).toContain("- metres");
    await pi.commands.get("undo-turn").handler("", ctx);
    expect(bridge.executed).toEqual(["scene.undo"]);
  });

  it("renders an untitled scene with no memory", () => {
    const block = contextBlock({ hip: null, current_network: null, selected: [], display_node: null, frame: 1 }, "  ", null);
    expect(block).toContain("hip: (untitled)");
    expect(block).toContain("(nothing selected)");
    expect(block).not.toContain("Hip memory");
    expect(block).not.toContain("Project memory");
  });

  it("shows hip and project memory in the context block", () => {
    const block = contextBlock({ hip: "/scenes/rock.hip", current_network: "/obj", selected: [], display_node: null, frame: 1 }, "## Conventions\n- metres", "## Pipeline\n- EXRs only");
    expect(block).toContain("## Hip memory for /scenes/rock.hip");
    expect(block).toContain("- metres");
    expect(block).toContain("## Project memory (shared across all hips in $JOB)");
    expect(block).toContain("- EXRs only");
  });

  it("omits project memory when unavailable", () => {
    const block = contextBlock({ hip: "/scenes/rock.hip", current_network: "/obj", selected: [], display_node: null, frame: 1 }, "hip text", null);
    expect(block).toContain("## Hip memory");
    expect(block).not.toContain("## Project memory");
  });
});
