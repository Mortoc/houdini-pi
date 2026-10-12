import { describe, expect, it } from "vitest";
import { decodeServer, encode, type ServerMessage } from "@houdini-pi/protocol";
import { FakeAgent } from "../src/fake-agent.js";
import { BridgeUnreachable } from "@houdini-pi/pi-package";
import { SessionHub, type HoudiniPort, type SocketLike } from "../src/hub.js";

class FakeSocket implements SocketLike {
  received: ServerMessage[] = [];
  private handlers: Record<string, ((data?: unknown) => void)[]> = {};
  send(data: string) { this.received.push(decodeServer(data)); }
  on(event: string, listener: (data?: unknown) => void) { (this.handlers[event] ??= []).push(listener); return this; }
  emit(event: string, data?: unknown) { for (const h of this.handlers[event] ?? []) h(data); }
  types() { return this.received.map((m) => m.type); }
  async waitFor(type: ServerMessage["type"], timeoutMs = 2000) {
    const started = Date.now();
    while (!this.received.some((m) => m.type === type)) {
      if (Date.now() - started > timeoutMs) throw new Error(`no ${type} within ${timeoutMs}ms; saw ${this.types().join(",")}`);
      await new Promise((r) => setTimeout(r, 2));
    }
  }
}

type FakeHoudini = HoudiniPort & { memory: string; prev: string | undefined; undos: number };

function fakeHoudini(overrides: Partial<HoudiniPort> = {}): FakeHoudini {
  const port: FakeHoudini = {
    memory: "# Memory\n",
    prev: undefined as string | undefined,
    undos: 0,
    hipPath: async () => "/scenes/test.hip",
    memoryRead: async () => ({ text: port.memory, prevAvailable: port.prev !== undefined }),
    memoryReplace: async (text: string) => { port.prev = port.memory; port.memory = text; },
    memoryRollback: async () => { if (port.prev !== undefined) { port.memory = port.prev; port.prev = undefined; } },
    undoTurn: async () => { port.undos++; },
    ...overrides,
  };
  return port;
}

async function settle() { await new Promise((r) => setTimeout(r, 5)); }

describe("SessionHub", () => {
  it("greets a pane with hello and history", async () => {
    const hub = new SessionHub(new FakeAgent(0), fakeHoudini());
    const socket = new FakeSocket();
    hub.attach(socket);
    await settle();
    expect(socket.types()).toEqual(["hello", "history"]);
    expect(socket.received[0]).toMatchObject({ hip: "/scenes/test.hip", fileTools: false, model: { id: "fake-fast" } });
  });

  it("streams one prompt to every attached pane in order", async () => {
    const agent = new FakeAgent(0);
    const hub = new SessionHub(agent, fakeHoudini());
    const a = new FakeSocket();
    const b = new FakeSocket();
    hub.attach(a);
    hub.attach(b);
    await settle();
    a.emit("message", encode({ type: "prompt", text: "thinner wires" }));
    await a.waitFor("settled");
    await b.waitFor("settled");
    const types = a.types().filter((t) => t !== "hello" && t !== "history");
    expect(types[0]).toBe("user_message");
    expect(types).toContain("thinking_delta");
    expect(types.indexOf("tool_start")).toBeLessThan(types.indexOf("tool_end"));
    expect(types.indexOf("tool_end")).toBeLessThan(types.indexOf("text_delta"));
    expect(types.indexOf("message_end")).toBeLessThan(types.indexOf("turn_end"));
    expect(types.at(-1)).toBe("state");
    expect(types.at(-2)).toBe("settled");
    expect(b.types().filter((t) => t === "text_delta").length).toBe(a.types().filter((t) => t === "text_delta").length);
    const settled = a.received.find((m) => m.type === "settled");
    expect(settled).toMatchObject({ aborted: false, cost: expect.any(Number) });
    expect(agent.calls).toEqual(["prompt:thinner wires"]);
  });

  it("aborts mid-stream and reports it", async () => {
    const agent = new FakeAgent(5);
    const hub = new SessionHub(agent, fakeHoudini());
    const socket = new FakeSocket();
    hub.attach(socket);
    await settle();
    socket.emit("message", encode({ type: "prompt", text: "go" }));
    await socket.waitFor("tool_start");
    socket.emit("message", encode({ type: "abort" }));
    await socket.waitFor("settled");
    expect(socket.received.find((m) => m.type === "settled")).toMatchObject({ aborted: true });
    expect(socket.types()).not.toContain("message_end");
  });

  it("forwards model, thinking and file-tool changes as state", async () => {
    const agent = new FakeAgent(0);
    const hub = new SessionHub(agent, fakeHoudini());
    const socket = new FakeSocket();
    hub.attach(socket);
    await settle();
    socket.emit("message", encode({ type: "set_model", provider: "fake", modelId: "fake-deep" }));
    socket.emit("message", encode({ type: "set_thinking", level: "high" }));
    socket.emit("message", encode({ type: "set_file_tools", enabled: true }));
    socket.emit("message", encode({ type: "list_models" }));
    await socket.waitFor("models");
    await settle();
    const last = socket.received.filter((m) => m.type === "state").at(-1);
    expect(last).toMatchObject({ model: { id: "fake-deep" }, thinkingLevel: "high", fileTools: true });
    expect(hub.fileToolsEnabled).toBe(true);
    expect(agent.calls).toContain("setModel:fake/fake-deep");
  });

  it("edits and rolls back memory through the Houdini port", async () => {
    const houdini = fakeHoudini();
    const hub = new SessionHub(new FakeAgent(0), houdini);
    const socket = new FakeSocket();
    hub.attach(socket);
    await settle();
    socket.emit("message", encode({ type: "memory_edit", text: "# New\n" }));
    await socket.waitFor("memory");
    expect(socket.received.find((m) => m.type === "memory")).toMatchObject({ text: "# New\n", prevAvailable: true });
    socket.emit("message", encode({ type: "undo_compaction" }));
    await settle();
    expect(houdini.memory).toBe("# Memory\n");
    socket.emit("message", encode({ type: "undo_turn" }));
    await settle();
    expect(houdini.undos).toBe(1);
  });

  it("answers a malformed message with an error and keeps serving", async () => {
    const hub = new SessionHub(new FakeAgent(0), fakeHoudini());
    const socket = new FakeSocket();
    hub.attach(socket);
    await settle();
    socket.emit("message", "{bad json");
    socket.emit("message", encode({ type: "list_models" }));
    await socket.waitFor("models");
    expect(socket.received.find((m) => m.type === "error")).toMatchObject({ message: expect.stringContaining("not JSON") });
  });

  it("tags a dead bridge with the reconnect action and an auth failure with login", async () => {
    const houdini = fakeHoudini({
      undoTurn: async () => { throw new BridgeUnreachable("http://127.0.0.1:8100/api", new Error("ECONNREFUSED")); },
      memoryReplace: async () => { throw new Error("No API key configured for provider openrouter"); },
    });
    const hub = new SessionHub(new FakeAgent(0), houdini);
    const socket = new FakeSocket();
    hub.attach(socket);
    await settle();
    socket.emit("message", encode({ type: "undo_turn" }));
    socket.emit("message", encode({ type: "memory_edit", text: "x" }));
    await settle();
    const errors = socket.received.filter((m) => m.type === "error");
    expect(errors).toEqual([
      expect.objectContaining({ action: "reconnect" }),
      expect.objectContaining({ action: "login" }),
    ]);
  });
});
