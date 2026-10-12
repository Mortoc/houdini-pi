/** Exit when the Houdini that spawned this sidecar is gone, so no orphan survives it. */
export interface WatchdogDeps {
  isAlive: (pid: number) => boolean;
  exit: (code: number) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const gone = (error as NodeJS.ErrnoException).code === "ESRCH";
    // EPERM means it exists but is not ours; anything else is unexpected and
    // treated as alive so a transient error never kills a healthy sidecar.
    return !gone;
  }
}

export function watchParent(pid: number, intervalMs: number, deps: WatchdogDeps = defaultDeps()) {
  const check = () => {
    if (!deps.isAlive(pid)) {
      deps.exit(0);
    }
  };
  deps.setInterval(check, intervalMs);
}

function defaultDeps(): WatchdogDeps {
  return {
    isAlive: processIsAlive,
    exit: (code) => process.exit(code),
    setInterval: (fn, ms) => setInterval(fn, ms).unref(),
  };
}
