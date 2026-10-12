import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { BridgeError, BridgeUnreachable, HoudiniBridge } from "../src/houdini-bridge.js";

interface Seen {
  fn: string;
  kwargs: Record<string, unknown>;
  contentType: string | undefined;
}

let server: Server | undefined;
afterEach(() => server?.close());

/** A stand-in for hwebserver's /api: records the RPC call and answers from `respond`. */
async function fakeBridge(respond: (seen: Seen) => unknown): Promise<{ port: number; calls: Seen[] }> {
  const calls: Seen[] = [];
  server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const form = new URLSearchParams(raw);
      const [fn, _positional, kwargs] = JSON.parse(form.get("json") ?? "null") as [string, unknown[], Record<string, unknown>];
      const seen = { fn, kwargs, contentType: request.headers["content-type"] };
      calls.push(seen);
      const answer = respond(seen);
      if (typeof answer === "number") {
        response.writeHead(answer);
        response.end("nope");
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(answer));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { port: typeof address === "object" && address ? address.port : 0, calls };
}

describe("HoudiniBridge", () => {
  it("posts hwebserver's form-encoded RPC shape", async () => {
    const { port, calls } = await fakeBridge(() => ({ status: "ok", pid: 7, houdini_version: "22.0.429" }));
    const health = await new HoudiniBridge(port).health();
    expect(health.houdini_version).toBe("22.0.429");
    expect(calls[0]?.fn).toBe("mcp.health");
    expect(calls[0]?.contentType).toBe("application/x-www-form-urlencoded");
  });

  it("unwraps a success envelope and sends command, params and a request id", async () => {
    const { port, calls } = await fakeBridge(() => ({ status: "success", data: { nodes: 3 } }));
    const data = await new HoudiniBridge(port).execute("scene.get_scene_info", { verbose: true });
    expect(data).toEqual({ nodes: 3 });
    expect(calls[0]?.fn).toBe("mcp.execute");
    expect(calls[0]?.kwargs["command"]).toBe("scene.get_scene_info");
    expect(calls[0]?.kwargs["params"]).toEqual({ verbose: true });
    expect(typeof calls[0]?.kwargs["request_id"]).toBe("string");
  });

  it("turns an error envelope into a BridgeError carrying the code", async () => {
    const { port } = await fakeBridge(() => ({ status: "error", error: { code: "UNKNOWN_COMMAND", message: "No handler" } }));
    await expect(new HoudiniBridge(port).execute("nope")).rejects.toMatchObject({ code: "UNKNOWN_COMMAND", message: "No handler" });
  });

  it("reports a refused connection as unreachable", async () => {
    const { port } = await fakeBridge(() => ({}));
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    await expect(new HoudiniBridge(port).execute("x")).rejects.toBeInstanceOf(BridgeUnreachable);
    expect(await new HoudiniBridge(port).isUp()).toBe(false);
  });

  it("reports a non-2xx as a BridgeError", async () => {
    const { port } = await fakeBridge(() => 403);
    await expect(new HoudiniBridge(port).execute("x")).rejects.toMatchObject({ code: "HTTP_403" });
  });

  it("runs a hooks_target helper and parses its JSON answer", async () => {
    const { port, calls } = await fakeBridge(() => ({
      status: "success",
      data: { success: true, executed: true, return_value: JSON.stringify({ hip: "/a.hip" }) },
    }));
    const context = await new HoudiniBridge(port).runHelper<{ hip: string }>("scene_context", { depth: 2 });
    expect(context).toEqual({ hip: "/a.hip" });
    const params = calls[0]?.kwargs["params"] as { code: string; return_expression: string };
    expect(params.code).toContain("import houdini_pi.hooks_target as _hooks");
    expect(params.code).toContain('json.loads("{\\"depth\\":2}")');
    expect(params.return_expression).toBe("json.dumps(_hooks.scene_context(**_kwargs))");
  });

  it("surfaces a Python traceback from execute_python as BridgeError", async () => {
    const { port } = await fakeBridge(() => ({
      status: "success",
      data: { success: false, executed: false, error: "Traceback ...\nNameError: x" },
    }));
    const failure = new HoudiniBridge(port).runHelper("begin_turn", { label: "x" });
    await expect(failure).rejects.toBeInstanceOf(BridgeError);
    await expect(failure).rejects.toMatchObject({ code: "PYTHON_ERROR", message: expect.stringContaining("NameError") });
  });
});
