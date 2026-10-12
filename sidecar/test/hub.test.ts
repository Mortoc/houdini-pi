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

type FakeHoudini = HoudiniPort & { memory: string; prev: string | undefined; undos: number; link: string; loaded: string[]; actions: string[] };

function fakeHoudini(overrides: Partial<HoudiniPort> = {}): FakeHoudini {
  const port: FakeHoudini = {
    memory: "# Memory\n",
    prev: undefined as string | undefined,
    undos: 0,
    link: "none",
    loaded: [] as string[],
    actions: [] as string[],
    hipPath: async () => "/scenes/test.hip",
    loadHip: async (path: string) => { port.loaded.push(path); },
    action: async (kind: string, value: string) => { port.actions.push(`${kind}:${value}`); },
    linkGroup: async () => port.link as "none",
    setLinkGroup: async (group) => { port.link = group; },
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
    expect(socket.received[0]).toMatchObject({ hip: "/scenes/test.hip", sessionName: "New Conversation", model: { id: "fake-fast" }, linkGroup: "none" });
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
    const types = a.types().filter((t) => t !== "hello" && t !== "history" && t !== "session_name");
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
    expect(agent.calls[0]).toBe("prompt:thinner wires");
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

  it("forwards model and thinking changes as state, and manual renames", async () => {
    const agent = new FakeAgent(0);
    const hub = new SessionHub(agent, fakeHoudini());
    const socket = new FakeSocket();
    hub.attach(socket);
    await settle();
    socket.emit("message", encode({ type: "set_model", provider: "fake", modelId: "fake-deep" }));
    socket.emit("message", encode({ type: "set_thinking", level: "high" }));
    socket.emit("message", encode({ type: "rename_session", name: "Wires" }));
    socket.emit("message", encode({ type: "list_models" }));
    await socket.waitFor("models");
    await settle();
    const last = socket.received.filter((m) => m.type === "state").at(-1);
    expect(last).toMatchObject({ model: { id: "fake-deep" }, thinkingLevel: "high" });
    expect(socket.received.find((m) => m.type === "session_name")).toMatchObject({ name: "Wires" });
    expect(agent.calls).toContain("setModel:fake/fake-deep");
    expect(agent.sessionName).toBe("Wires");
  });

  it("names the session with the cheapest model after the first user message", async () => {
    const agent = new FakeAgent(0);
    const hub = new SessionHub(agent, fakeHoudini());
    const socket = new FakeSocket();
    hub.attach(socket);
    await settle();
    socket.emit("message", encode({ type: "prompt", text: "spawn an env light" }));
    await socket.waitFor("session_name");
    expect(socket.received.find((m) => m.type === "session_name")).toMatchObject({ name: expect.stringContaining("Named:") });
    expect(agent.calls).toContain("complete:fake-nano");
    agent.calls.length = 0;
    socket.emit("message", encode({ type: "prompt", text: "second" }));
    await socket.waitFor("settled");
    await settle();
    expect(agent.calls.filter((c) => c.startsWith("complete:"))).toEqual([]);
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
    socket.emit("message", encode({ type: "set_link_group", group: "2" }));
    await socket.waitFor("link_group");
    expect(houdini.link).toBe("2");
    expect(socket.received.find((m) => m.type === "link_group")).toMatchObject({ group: "2" });
  });

  it("offers only vision models and passes tool images through", async () => {
    const hub = new SessionHub(new FakeAgent(0), fakeHoudini());
    const socket = new FakeSocket();
    hub.attach(socket);
    await settle();
    socket.emit("message", encode({ type: "list_models" }));
    await socket.waitFor("models");
    const models = socket.received.find((m) => m.type === "models") as { models: { id: string }[] };
    expect(models.models.map((m) => m.id)).toEqual(["fake-fast", "fake-deep"]);
    socket.emit("message", encode({ type: "prompt", text: "look" }));
    await socket.waitFor("settled");
    const inspect = socket.received.find((m) => m.type === "tool_end" && m.toolName === "inspect_cop") as { imageUrl?: string };
    expect(inspect.imageUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("tells the host when a pane reconnects on a different hip", async () => {
    const houdini = fakeHoudini();
    let hip = "/scenes/a.hip";
    houdini.hipPath = async () => hip;
    const changes: (string | undefined)[] = [];
    const hub = new SessionHub(new FakeAgent(0), houdini, undefined, async (next) => { changes.push(next); });
    hub.attach(new FakeSocket());
    await settle();
    hub.attach(new FakeSocket());
    await settle();
    expect(changes).toEqual([]);
    hip = "/scenes/b.hip";
    const socket = new FakeSocket();
    hub.attach(socket);
    await settle();
    expect(changes).toEqual(["/scenes/b.hip"]);
    expect(socket.received[0]).toMatchObject({ type: "hello", hip: "/scenes/b.hip" });
  });

  it("lists sessions with their hip and loads the hip when switching to one", async () => {
    const houdini = fakeHoudini();
    const agent = new FakeAgent(0);
    const hub = new SessionHub(agent, houdini, undefined, undefined, (path) => (path === "/sessions/old.jsonl" ? "/scenes/other.hip" : "/scenes/test.hip"));
    const socket = new FakeSocket();
    hub.attach(socket);
    await settle();
    socket.emit("message", encode({ type: "list_sessions" }));
    await socket.waitFor("sessions");
    expect((socket.received.find((m) => m.type === "sessions") as { sessions: { hip?: string }[] }).sessions[0]?.hip).toBe("/scenes/test.hip");
    socket.emit("message", encode({ type: "switch_session", sessionPath: "/sessions/old.jsonl" }));
    await settle();
    expect(agent.calls).toContain("switch:/sessions/old.jsonl");
    expect(houdini.loaded).toEqual(["/scenes/other.hip"]);
    socket.emit("message", encode({ type: "switch_session", sessionPath: "/sessions/same.jsonl" }));
    await settle();
    expect(houdini.loaded).toEqual(["/scenes/other.hip"]);
  });

  it("relays answers to the pane and button actions to Houdini", async () => {
    const houdini = fakeHoudini();
    const hub = new SessionHub(new FakeAgent(0), houdini);
    const socket = new FakeSocket();
    hub.attach(socket);
    await settle();
    socket.emit("message", encode({ type: "prompt", text: "How do I thin the wires?" }));
    await socket.waitFor("settled");
    const answer = socket.received.find((m) => m.type === "tool_end" && m.toolName === "present_answer") as { answer?: { markdown: string; invalid: Record<string, string> } };
    expect(answer.answer?.markdown).toContain("houdini://parm?path=/obj/geo1/wire1/radius");
    expect(answer.answer?.invalid).toEqual({ "houdini://select?path=/obj/nope": "nothing at /obj/nope" });
    socket.emit("message", encode({ type: "houdini_action", kind: "parm", value: "/obj/geo1/wire1/radius" }));
    await settle();
    expect(houdini.actions).toEqual(["parm:/obj/geo1/wire1/radius"]);
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
