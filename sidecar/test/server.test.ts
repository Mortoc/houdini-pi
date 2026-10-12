import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { LOOPBACK, startServer, type RunningServer } from "../src/server.js";

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function start(extra: Partial<Parameters<typeof startServer>[0]> = {}) {
  running = await startServer({
    host: LOOPBACK,
    port: 0,
    token: "secret",
    staticDir: undefined,
    onConnection: () => {},
    ...extra,
  });
  return running;
}

function upgradeStatus(url: string): Promise<number | "open"> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.on("open", () => {
      ws.close();
      resolve("open");
    });
    ws.on("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
    ws.on("error", () => {});
  });
}

describe("sidecar server", () => {
  it("refuses to bind anything but loopback", () => {
    expect(() =>
      startServer({ host: "0.0.0.0", port: 0, token: "t", staticDir: undefined, onConnection: () => {} }),
    ).toThrow(/refusing to bind 0\.0\.0\.0/);
  });

  it("answers /health with its pid and extra fields", async () => {
    const { port } = await start({ health: () => ({ houdiniPort: 8100 }) });
    const body = await (await fetch(`http://${LOOPBACK}:${port}/health`)).json();
    expect(body).toEqual({ ok: true, pid: process.pid, houdiniPort: 8100 });
  });

  it("rejects a websocket upgrade without the launch token", async () => {
    const { port } = await start();
    expect(await upgradeStatus(`ws://${LOOPBACK}:${port}/ws`)).toBe(401);
    expect(await upgradeStatus(`ws://${LOOPBACK}:${port}/ws?token=wrong`)).toBe(401);
  });

  it("accepts the upgrade with the token and hands the socket over", async () => {
    let connections = 0;
    const { port } = await start({ onConnection: () => connections++ });
    expect(await upgradeStatus(`ws://${LOOPBACK}:${port}/ws?token=secret`)).toBe("open");
    expect(connections).toBe(1);
  });

  it("serves conversation assets only with the token and never outside the assets dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "houdini-pi-assets-"));
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(dir, "s1"));
    writeFileSync(join(dir, "s1", "c1.png"), "png!");
    const { port } = await start({ assetsDir: dir });
    expect((await fetch(`http://${LOOPBACK}:${port}/session-assets/s1/c1.png`)).status).toBe(401);
    const ok = await fetch(`http://${LOOPBACK}:${port}/session-assets/s1/c1.png?token=secret`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(await ok.text()).toBe("png!");
    expect((await fetch(`http://${LOOPBACK}:${port}/session-assets/..%2f..%2fetc/passwd?token=secret`)).status).toBe(404);
  });

  it("serves the static dir, index at /, and never escapes it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "houdini-pi-static-"));
    writeFileSync(join(dir, "index.html"), "<h1>pane</h1>");
    const { port } = await start({ staticDir: dir });
    const index = await fetch(`http://${LOOPBACK}:${port}/`);
    expect(index.headers.get("content-type")).toMatch(/text\/html/);
    expect(await index.text()).toBe("<h1>pane</h1>");
    expect((await fetch(`http://${LOOPBACK}:${port}/missing.js`)).status).toBe(404);
    expect((await fetch(`http://${LOOPBACK}:${port}/..%2f..%2fetc/passwd`)).status).toBe(404);
  });
});
