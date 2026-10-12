/**
 * Serialises follow-the-agent calls so each selection stays on screen for at
 * least `minGapMs`. Tool calls can finish tens of milliseconds apart; the
 * artist still sees every step, just not faster than they can look.
 */
export interface FollowQueueDeps {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export class FollowQueue<T> {
  private chain: Promise<unknown> = Promise.resolve();
  private lastShownAt = Number.NEGATIVE_INFINITY;
  private pending = 0;

  constructor(
    private readonly run: (paths: string[]) => Promise<T>,
    private readonly minGapMs = 500,
    private readonly deps: FollowQueueDeps = { now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
  ) {}

  /** Queue one follow; resolves with the run's result once it has been shown. */
  enqueue(paths: string[]): Promise<T> {
    this.pending++;
    const next = this.chain.then(async () => {
      const wait = this.lastShownAt + this.minGapMs - this.deps.now();
      if (wait > 0) await this.deps.sleep(wait);
      try {
        return await this.run(paths);
      } finally {
        this.lastShownAt = this.deps.now();
        this.pending--;
      }
    });
    this.chain = next.catch(() => undefined);
    return next;
  }

  get size(): number {
    return this.pending;
  }

  /** Resolves once everything queued so far has been shown. */
  idle(): Promise<void> {
    return this.chain.then(() => undefined);
  }
}
