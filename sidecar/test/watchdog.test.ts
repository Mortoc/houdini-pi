import { describe, expect, it } from "vitest";
import { processIsAlive, watchParent } from "../src/watchdog.js";

describe("parent watchdog", () => {
  it("exits once the parent pid is gone", () => {
    let alive = true;
    let exitCode: number | undefined;
    let tick: (() => void) | undefined;
    watchParent(4242, 10, {
      isAlive: () => alive,
      exit: (code) => (exitCode = code),
      setInterval: (fn) => (tick = fn),
    });
    tick?.();
    expect(exitCode).toBeUndefined();
    alive = false;
    tick?.();
    expect(exitCode).toBe(0);
  });

  it("sees its own process as alive and a dead pid as gone", () => {
    expect(processIsAlive(process.pid)).toBe(true);
    expect(processIsAlive(2 ** 22 - 1)).toBe(false);
  });
});
