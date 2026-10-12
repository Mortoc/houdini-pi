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
    readonly timeoutMs = 60_000,
  ) {
    this.url = `http://127.0.0.1:${port}/api`;
  }

  private async call(fn: string, kwargs: Record<string, unknown>, timeoutMs = this.timeoutMs): Promise<unknown> {
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
    const envelope = (await this.call("mcp.execute", { command, params, request_id: randomUUID() })) as Envelope;
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
