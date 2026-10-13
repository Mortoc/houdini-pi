/**
 * HTTP client for the fxhoudinimcp bridge inside Houdini.
 *
 * Wire format (fxhoudinimcp v2.25.0, python/fxhoudinimcp/bridge.py):
 *   POST /api, application/x-www-form-urlencoded,
 *   json=["mcp.execute", [], {"command": ..., "params": {...}, "request_id": ...}]
 * The dispatcher answers {"status": "success", "data": ...} or
 * {"status": "error", "error": {"code", "message", ...}}; mcp.health answers
 * {"status": "ok", "pid", "houdini_version"} without touching HOM.
 *
 * The bridge rejects any request carrying an Origin header, so only this
 * process, never the pane's page, may call it.
 */
import { randomUUID } from "node:crypto";

export class BridgeUnreachable extends Error {
  constructor(public readonly url: string, cause: unknown) {
    super(`Houdini bridge at ${url} is not answering. Is Houdini running with the fxhoudinimcp plugin loaded?`, { cause });
  }
}

/**
 * Houdini is up but did not answer in time: a long cook, a modal dialog, or a main thread
 * blocked some other way. Not "is Houdini running?", which is what a plain timeout used to
 * report while Houdini sat there frozen.
 */
export class BridgeBusy extends Error {
  constructor(public readonly url: string, public readonly seconds: number, cause: unknown) {
    super(
      `Houdini did not answer within ${seconds} s. It is busy on its main thread (a long cook, a modal dialog box, or a stuck call); check the Houdini window.`,
      { cause },
    );
  }
}

/** What fxhoudinimcp's dispatcher allows a bounded command when nothing overrides it. */
export const BRIDGE_DEFAULT_TIMEOUT_S = 120;
/** How much longer than the bridge this client waits, so the bridge's own TIMEOUT answer arrives first. */
const TIMEOUT_MARGIN_S = 15;

/**
 * Milliseconds to wait for `command`: the bridge's own deadline for it plus a margin.
 *
 * Mirrors fxhoudinimcp's `command_timeout` (dispatcher.py): FXHOUDINIMCP_TIMEOUT_<COMMAND>,
 * then FXHOUDINIMCP_TIMEOUT, then 120 s. Read from this process's environment, which Houdini
 * hands down from the package file that sets them. A client deadline SHORTER than the
 * bridge's is the bug this replaces: the client gave up at 60 s and called a frozen Houdini
 * unreachable while the bridge was still inside its 120 s.
 *
 * Only for bounded commands. Upstream runs a few (write_cache, start_render) with no
 * deadline; nothing here sends them.
 */
export function commandTimeoutMs(command: string, env: Record<string, string | undefined> = process.env): number {
  const specific = "FXHOUDINIMCP_TIMEOUT_" + command.toUpperCase().replaceAll(".", "_");
  for (const name of [specific, "FXHOUDINIMCP_TIMEOUT"]) {
    const seconds = Number((env[name] ?? "").trim());
    if (Number.isFinite(seconds) && seconds > 0) return (seconds + TIMEOUT_MARGIN_S) * 1000;
  }
  return (BRIDGE_DEFAULT_TIMEOUT_S + TIMEOUT_MARGIN_S) * 1000;
}

export class BridgeError extends Error {
  constructor(public readonly code: string, message: string, public readonly traceback?: string) {
    super(message);
  }
}

export interface ExecutePythonResult {
  success: boolean;
  executed: boolean;
  return_value?: unknown;
  stdout?: string;
  stderr?: string;
  error?: string;
  eval_error?: string;
}

export interface BridgeHealth {
  status: "ok";
  pid: number;
  houdini_version: string;
}

type Envelope =
  | { status: "success"; data: unknown; request_id?: string }
  | { status: "error"; error: { code: string; message: string; traceback?: string }; request_id?: string };

export const HOOKS_MODULE = "houdini_pi.hooks_target";

export class HoudiniBridge {
  readonly url: string;

  constructor(
    readonly port: number,
    private readonly fetchImpl: typeof fetch = fetch,
    /** One deadline for every call; by default each command gets the bridge's own plus a margin. */
    readonly timeoutMs?: number,
  ) {
    this.url = `http://127.0.0.1:${port}/api`;
  }

  private async call(fn: string, kwargs: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const body = new URLSearchParams({ json: JSON.stringify([fn, [], kwargs]) });
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if ((error as Error)?.name === "TimeoutError") throw new BridgeBusy(this.url, Math.round(timeoutMs / 1000), error);
      throw new BridgeUnreachable(this.url, error);
    }
    if (!response.ok) {
      throw new BridgeError(`HTTP_${response.status}`, `Houdini bridge returned HTTP ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }

  async health(timeoutMs = 1_000): Promise<BridgeHealth> {
    const payload = (await this.call("mcp.health", {}, timeoutMs)) as Partial<BridgeHealth>;
    if (payload.status !== "ok") throw new BridgeError("BAD_HEALTH", `unexpected health payload: ${JSON.stringify(payload)}`);
    return payload as BridgeHealth;
  }

  async isUp(): Promise<boolean> {
    try {
      await this.health();
      return true;
    } catch {
      return false;
    }
  }

  async execute(command: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const envelope = (await this.call("mcp.execute", { command, params, request_id: randomUUID() }, this.timeoutMs ?? commandTimeoutMs(command))) as Envelope;
    if (envelope.status === "success") return envelope.data;
    if (envelope.status === "error") throw new BridgeError(envelope.error.code, envelope.error.message, envelope.error.traceback);
    throw new BridgeError("BAD_ENVELOPE", `unexpected bridge envelope: ${JSON.stringify(envelope)}`);
  }

  async executePython(code: string, returnExpression?: string): Promise<ExecutePythonResult> {
    const params: Record<string, unknown> = { code };
    if (returnExpression !== undefined) params["return_expression"] = returnExpression;
    const result = (await this.execute("code.execute_python", params)) as ExecutePythonResult;
    if (!result.success) {
      throw new BridgeError("PYTHON_ERROR", result.error ?? result.eval_error ?? "execute_python failed", result.error ?? result.eval_error);
    }
    return result;
  }

  /** Run `houdini_pi.hooks_target.<name>(**kwargs)` in Houdini and return its JSON-serialisable result. */
  async runHelper<T = unknown>(name: string, kwargs: Record<string, unknown> = {}): Promise<T> {
    const code = `import json\nimport ${HOOKS_MODULE} as _hooks\n_kwargs = json.loads(${JSON.stringify(JSON.stringify(kwargs))})`;
    const result = await this.executePython(code, `json.dumps(_hooks.${name}(**_kwargs))`);
    if (typeof result.return_value !== "string") {
      throw new BridgeError("BAD_HELPER_RESULT", `${name} returned ${JSON.stringify(result.return_value)}, expected a JSON string`);
    }
    return JSON.parse(result.return_value) as T;
  }
}
