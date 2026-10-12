import { describe, expect, it } from "vitest";
import { contextBlock, createHoudiniExtension, DIRECT_TOOLS, mcpServerConfig, uvxCommand, type HoudiniExtensionBridge, type SceneContext } from "../extensions/houdini.js";

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
  memory = "## Conventions\n\n- metres\n";
  prev: string | null = null;
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
      case "begin_turn": if (this.failBeginTurn) throw new Error("hou exploded"); return undefined as T;
      case "end_turn": return undefined as T;
    }
    throw new Error(`unexpected helper ${name}`);
  }
  helperNames() { return this.calls.map((c) => c.name); }
}

function load(bridge: FakeBridge, extra: Partial<Parameters<typeof createHoudiniExtension>[0]> = {}) {
  const pi = new FakeExtensionAPI();
  createHoudiniExtension({ bridge, houdiniPort: 8103, ...extra })(pi as any);
  return pi;
}

describe("houdini extension", () => {
  it("registers fxhoudini as an MCP server on the given Houdini port with curated direct tools", () => {
    const pi = load(new FakeBridge());
    const config = pi.mcp.get("fxhoudini");
    expect(config.command).toBe("uvx");
    expect(config.args).toEqual(["--from", expect.stringContaining("fxhoudinimcp@v"), "fxhoudinimcp"]);
    expect(config.env).toEqual({ HOUDINI_PORT: "8103" });
    expect(config.exposure).toBe("codemode");
    expect(config.toolExposure["set_parameter"]).toBe("direct");
    expect(Object.keys(config.toolExposure)).toHaveLength(DIRECT_TOOLS.length);
    expect(mcpServerConfig(8100).env).toEqual({ HOUDINI_PORT: "8100" });
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
    expect(result.message.content).toContain("## Project memory for /scenes/rock.hip");
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
    expect(blocked).toMatchObject({ block: true, reason: expect.stringContaining("enable file tools") });
    const [houdini] = await pi.fire("tool_call", { toolName: "mcp__fxhoudini__set_parameter", toolCallId: "2", input: {} });
    expect(houdini).toBeUndefined();
    enabled = true;
    const [allowed] = await pi.fire("tool_call", { toolName: "edit", toolCallId: "3", input: {} });
    expect(allowed).toBeUndefined();
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
    const block = contextBlock({ hip: null, current_network: null, selected: [], display_node: null, frame: 1 }, "  ");
    expect(block).toContain("hip: (untitled)");
    expect(block).toContain("(nothing selected)");
    expect(block).not.toContain("Project memory");
  });
});
