import { describe, expect, it } from "vitest";
import { parseCli } from "../src/index.js";

describe("sidecar CLI", () => {
  it("requires a token and, without the fake agent, a parent pid", () => {
    expect(() => parseCli(["--port", "9123"])).toThrow(/--parent-pid is required/);
    expect(() => parseCli(["--fake-agent"])).toThrow(/--token is required/);
  });

  it("parses the launch arguments the panel sends", () => {
    const cli = parseCli(["--port", "9123", "--houdini-port", "8101", "--parent-pid", "4242", "--token", "abc"]);
    expect(cli).toMatchObject({ host: "127.0.0.1", port: 9123, houdiniPort: 8101, parentPid: 4242, token: "abc", fakeAgent: false });
  });

  it("rejects non-integer ports", () => {
    expect(() => parseCli(["--fake-agent", "--token", "t", "--port", "nine"])).toThrow(/--port must be/);
  });
});
