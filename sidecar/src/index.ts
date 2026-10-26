#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createHoudiniExtension, DEFAULT_ASSETS_DIR, HoudiniBridge } from "@houdini-pi/pi-package";
import type { AgentLike } from "./agent-like.js";
import type { PiAgent as PiAgentType } from "./pi-agent.js";
import { FakeAgent } from "./fake-agent.js";
import { houdiniPort } from "./houdini-port.js";
import { followHip, SessionHub, type HoudiniPort } from "./hub.js";
import { LOOPBACK, startServer } from "./server.js";
import { SessionIndex } from "./session-index.js";
import { loadSettings } from "./settings.js";
import { watchParent } from "./watchdog.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The default house rules, shipped with houdini-pi. Project memory overrides these. */
function loadHouseRules(): string {
  try {
    return readFileSync(join(REPO_ROOT, "pi", "skills", "houdini", "HOUSE-RULES.md"), "utf-8");
  } catch {
    return "";
  }
}

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
  const sessions: string[] = [];
  return {
    hipPath: async () => "/fake/scenes/rock.hip",
    hipSessions: async () => [...sessions],
    tagSession: async (path) => { if (!sessions.includes(path)) sessions.push(path); },
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
    // Pinned to the Houdini that spawned us: with two Houdinis open, a port can belong to the other one.
    const bridge = new HoudiniBridge(cli.houdiniPort, fetch, undefined, cli.parentPid);
    houdini = houdiniPort(bridge);
    const index = new SessionIndex();
    const { PiAgent } = await import("./pi-agent.js");
    let hubRef: SessionHub | undefined;
    let piAgent: PiAgentType | undefined;
    const extension = createHoudiniExtension({
      bridge,
      houdiniPort: cli.houdiniPort,
      followNodes: () => settings.followNodes,
      autoLayout: () => settings.layout.autoLayout,
      houseRules: loadHouseRules(),
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
    hub = new SessionHub(
      agent,
      houdini,
      settings,
      () => followHip(agent, houdini),
      (hip) => index.sessionsOf(hip),
    );
    hubRef = hub;
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
