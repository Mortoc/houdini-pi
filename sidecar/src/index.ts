#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createHoudiniExtension, DEFAULT_ASSETS_DIR, HoudiniBridge } from "@houdini-pi/pi-package";
import type { AgentLike } from "./agent-like.js";
import type { PiAgent as PiAgentType } from "./pi-agent.js";
import { FakeAgent } from "./fake-agent.js";
import { houdiniPort } from "./houdini-port.js";
import { SessionHub, type HoudiniPort } from "./hub.js";
import { LOOPBACK, startServer } from "./server.js";
import { SessionIndex } from "./session-index.js";
import { loadSettings } from "./settings.js";
import { watchParent } from "./watchdog.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export function parseCli(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      host: { type: "string", default: LOOPBACK },
      port: { type: "string", default: "0" },
      "houdini-port": { type: "string", default: "8100" },
      "parent-pid": { type: "string" },
      token: { type: "string" },
      "fake-agent": { type: "boolean", default: false },
      "static-dir": { type: "string", default: resolve(REPO_ROOT, "ui", "dist") },
    },
  });
  const port = Number(values.port);
  const houdiniPort = Number(values["houdini-port"]);
  const parentPid = values["parent-pid"] === undefined ? undefined : Number(values["parent-pid"]);
  const needs_parent = !values["fake-agent"] && parentPid === undefined;
  if (needs_parent) throw new Error("--parent-pid is required unless --fake-agent is set");
  if (values.token === undefined) throw new Error("--token is required");
  for (const [name, value] of Object.entries({ port, houdiniPort, parentPid })) {
    const bad = value !== undefined && (!Number.isInteger(value) || value < 0);
    if (bad) throw new Error(`--${name} must be a non-negative integer`);
  }
  return { host: values.host!, port, houdiniPort, parentPid, token: values.token, fakeAgent: values["fake-agent"]!, staticDir: values["static-dir"]! };
}

function fakeHoudini(): HoudiniPort {
  let memory = "## Conventions\n\n- metres everywhere\n";
  let prev: string | undefined;
  let projectMemory = "## Pipeline\n\n- renders go to /show/renders\n";
  let projectPrev: string | undefined;
  return {
    hipPath: async () => "/fake/scenes/rock.hip",
    loadHip: async () => {},
    action: async () => {},
    memoryRead: async () => ({ text: memory, prevAvailable: prev !== undefined }),
    memoryReplace: async (text) => { prev = memory; memory = text; },
    memoryRollback: async () => { if (prev !== undefined) { memory = prev; prev = undefined; } },
    projectMemoryRead: async () => ({ available: true, text: projectMemory, prevAvailable: projectPrev !== undefined }),
    projectMemoryReplace: async (text) => { projectPrev = projectMemory; projectMemory = text; },
    undoTurn: async () => {},
  };
}

export async function main(argv = process.argv.slice(2)) {
  const cli = parseCli(argv);
  const settings = loadSettings();
  let agent: AgentLike;
  let houdini: HoudiniPort;
  let hub: SessionHub;

  if (cli.fakeAgent) {
    agent = new FakeAgent();
    houdini = fakeHoudini();
    hub = new SessionHub(agent, houdini, settings);
  } else {
    const bridge = new HoudiniBridge(cli.houdiniPort);
    houdini = houdiniPort(bridge);
    const index = new SessionIndex();
    const hip = await houdini.hipPath().catch(() => undefined);
    const { PiAgent } = await import("./pi-agent.js");
    let hubRef: SessionHub | undefined;
    let piAgent: PiAgentType | undefined;
    const extension = createHoudiniExtension({
      bridge,
      houdiniPort: cli.houdiniPort,
      followNodes: () => settings.followNodes,
      autoLayout: () => settings.layout.autoLayout,
      onBackup: (report) => {
        if ("error" in report) hubRef?.broadcast({ type: "error", message: `backup before the turn failed: ${report.error}` });
        if ("skipped" in report) hubRef?.broadcast({ type: "error", message: `no backup this turn: ${report.skipped}` });
      },
      condense: (prompt) => piAgent!.condense(prompt),
      onCompaction: (report) => {
        if ("error" in report) hubRef?.broadcast({ type: "error", message: `memory compaction failed: ${report.error}` });
        else hubRef?.broadcast({ type: "memory_compacted", ...report });
      },
    });
    // Always a fresh conversation on launch; earlier ones are in the sessions tab.
    piAgent = await PiAgent.create({
      cwd: REPO_ROOT,
      extensions: [extension],
      defaultModel: settings.defaultModel,
      onExtensionError: (error) => hubRef?.broadcast({ type: "error", message: `extension error: ${String(error)}` }),
    });
    agent = piAgent;
    let currentHip = hip;
    // Fetch the hip fresh each turn: Save As changes the path without a
    // reconnect, so the cached value goes stale and the session would be
    // tagged with the old file. The hub's cache is updated too, so the next
    // reconnect does not think the hip changed.
    const remember = async () => {
      const fresh = await houdini.hipPath().catch(() => undefined);
      if (fresh !== undefined) {
        currentHip = fresh;
        hubRef?.setHip(fresh);
      }
      if (currentHip !== undefined && agent.sessionPath !== undefined) index.tag(agent.sessionPath, currentHip);
    };
    hub = new SessionHub(
      agent,
      houdini,
      settings,
      async (nextHip) => {
        currentHip = nextHip;
        // A session switch that loaded its own hip arrives here too; that one
        // already matches and keeps its conversation.
        const matches = agent.sessionPath !== undefined && index.hipOf(agent.sessionPath) === nextHip;
        if (!matches) await agent.newSession();
      },
      (sessionPath) => index.hipOf(sessionPath),
    );
    hubRef = hub;
    agent.subscribe((event) => {
      if (event.type === "agent_settled") void remember();
    });
  }

  const server = await startServer({
    host: cli.host,
    port: cli.port,
    token: cli.token,
    staticDir: existsSync(cli.staticDir) ? cli.staticDir : undefined,
    assetsDir: DEFAULT_ASSETS_DIR,
    onConnection: (socket) => hub.attach(socket),
    health: () => ({ houdiniPort: cli.houdiniPort, fakeAgent: cli.fakeAgent }),
  });
  if (cli.parentPid !== undefined) watchParent(cli.parentPid, 2_000);
  console.log(`[houdini-pi] sidecar listening on http://${LOOPBACK}:${server.port}/?token=${cli.token}`);
  return server;
}

const invoked_directly = process.argv[1] !== undefined && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;
if (invoked_directly) {
  main().catch((error) => {
    console.error(`[houdini-pi] ${(error as Error).stack ?? error}`);
    process.exit(1);
  });
}
