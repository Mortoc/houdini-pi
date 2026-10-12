import { describe, expect, it } from "vitest";
import { FollowQueue } from "../extensions/follow-queue.js";

function clock() {
  let t = 0;
  const slept: number[] = [];
  return {
    deps: { now: () => t, sleep: async (ms: number) => { slept.push(ms); t += ms; } },
    advance: (ms: number) => (t += ms),
    slept,
  };
}

describe("FollowQueue", () => {
  it("runs every call, at least 500 ms apart, in order", async () => {
    const { deps, advance, slept } = clock();
    const shown: string[][] = [];
    const queue = new FollowQueue(async (paths) => { shown.push(paths); return paths.length; }, 500, deps);
    const a = queue.enqueue(["/obj/a"]);
    advance(20);
    const b = queue.enqueue(["/obj/b"]);
    const c = queue.enqueue(["/obj/c"]);
    expect(queue.size).toBe(3);
    expect(await Promise.all([a, b, c])).toEqual([1, 1, 1]);
    expect(shown).toEqual([["/obj/a"], ["/obj/b"], ["/obj/c"]]);
    expect(slept).toEqual([500, 500]);
    expect(queue.size).toBe(0);
  });

  it("does not wait when calls are already far apart", async () => {
    const { deps, advance, slept } = clock();
    const queue = new FollowQueue(async () => undefined, 500, deps);
    await queue.enqueue(["/a"]);
    advance(2000);
    await queue.enqueue(["/b"]);
    expect(slept).toEqual([]);
  });

  it("a failing run does not block the ones after it, and idle() waits for all", async () => {
    const { deps } = clock();
    let calls = 0;
    const queue = new FollowQueue(async () => { calls++; if (calls === 1) throw new Error("bridge down"); }, 500, deps);
    const first = queue.enqueue(["/a"]);
    const second = queue.enqueue(["/b"]);
    await expect(first).rejects.toThrow("bridge down");
    await queue.idle();
    await second;
    expect(calls).toBe(2);
  });
});
