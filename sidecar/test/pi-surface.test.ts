/**
 * `npm run check-pi`: the pi API surface the sidecar relies on. A pi bump that
 * changes any of these fails here with the symbol named, before anything
 * else in the sidecar has a chance to break at runtime.
 */
import * as pi from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

describe("pi SDK surface", () => {
  it("exports the session, runtime and extension factories we call", () => {
    for (const name of [
      "createAgentSessionRuntime",
      "createAgentSessionServices",
      "createAgentSessionFromServices",
      "createMcpExtension",
      "createCodemodeExtension",
      "createToolSearchExtension",
      "getAgentDir",
      "SessionManager",
      "AgentSession",
      "AgentSessionRuntime",
    ] as const) {
      expect(typeof pi[name], name).toMatch(/function/);
    }
  });

  it("keeps the AgentSession methods the adapter uses", () => {
    const proto = pi.AgentSession.prototype as unknown as Record<string, unknown>;
    for (const method of ["subscribe", "prompt", "steer", "followUp", "abort", "setModel", "setThinkingLevel", "compact", "bindExtensions", "getSessionStats", "dispose"]) {
      expect(typeof proto[method], method).toBe("function");
    }
    const runtime = pi.AgentSessionRuntime.prototype as unknown as Record<string, unknown>;
    for (const method of ["newSession", "switchSession", "fork", "setRebindSession", "dispose"]) {
      expect(typeof runtime[method], method).toBe("function");
    }
    for (const method of ["create", "open", "list", "inMemory"]) {
      expect(typeof (pi.SessionManager as unknown as Record<string, unknown>)[method], method).toBe("function");
    }
  });

  it("is the exact version package.json pins", async () => {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const installed = pi.VERSION;
    const pinned = require("../package.json").dependencies["@earendil-works/pi-coding-agent"] as string;
    expect(pinned, "pin pi exactly; its API moves between minors").toMatch(/^\d+\.\d+\.\d+$/);
    expect(installed).toBe(pinned);
  });
});
