/**
 * Per-hip project memory: curated markdown that travels with the .hip file.
 *
 * Stored on the root node's user data through `houdini_pi.hooks_target`
 * helpers, so it dirties the scene like any edit and rides along through
 * save-as and version control. `.prev` holds the pre-compaction text for a
 * one-step rollback.
 */

export interface MemoryBridge {
  runHelper<T = unknown>(name: string, kwargs?: Record<string, unknown>): Promise<T>;
}

export interface MemorySnapshot {
  text: string;
  prev: string | null;
}

export const TOKENS_PER_CHAR = 0.25;
export const COMPACT_THRESHOLD_TOKENS = 16_384;
export const COMPACT_TARGET_TOKENS = 8_192;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}

export class MemoryStore {
  constructor(private readonly bridge: MemoryBridge) {}

  async snapshot(): Promise<MemorySnapshot> {
    return this.bridge.runHelper<MemorySnapshot>("memory_read");
  }

  async read(): Promise<string> {
    return (await this.snapshot()).text;
  }

  async prevAvailable(): Promise<boolean> {
    return (await this.snapshot()).prev !== null;
  }

  async replace(text: string): Promise<void> {
    const current = await this.snapshot();
    await this.bridge.runHelper("memory_write", { text, prev: current.text });
  }

  async append(section: string, text: string): Promise<string> {
    const current = (await this.snapshot()).text;
    const next = appendToSection(current, section, text);
    await this.bridge.runHelper("memory_write", { text: next, prev: current });
    return next;
  }

  /** Restore the pre-compaction text. Throws when there is nothing to roll back to. */
  async rollback(): Promise<void> {
    const current = await this.snapshot();
    if (current.prev === null) throw new Error("no previous memory to roll back to");
    await this.bridge.runHelper("memory_write", { text: current.prev, prev: null });
  }
}

/** Append `text` under `## <section>`, creating the heading at the end when absent. */
export function appendToSection(memory: string, section: string, text: string): string {
  const heading = `## ${section.trim()}`;
  const lines = memory.length === 0 ? [] : memory.replace(/\s+$/, "").split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  const entry = text.trim();
  if (start === -1) {
    const prefix = lines.length === 0 ? [] : [...lines, ""];
    return [...prefix, heading, "", entry, ""].join("\n");
  }
  let end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  if (end === -1) end = lines.length;
  while (end > start + 1 && lines[end - 1]?.trim() === "") end--;
  const rest = lines.slice(end);
  while (rest[0]?.trim() === "") rest.shift();
  const updated = [...lines.slice(0, end), entry, ...(rest.length > 0 ? ["", ...rest] : [])];
  return `${updated.join("\n")}\n`;
}

export interface CompactorOptions {
  thresholdTokens?: number;
  targetTokens?: number;
  /** Runs the one-shot condense prompt and returns the condensed markdown. */
  condense: (prompt: string) => Promise<string>;
}

export interface CompactionReport {
  before: number;
  after: number;
}

export class Compactor {
  private readonly threshold: number;
  private readonly target: number;

  constructor(private readonly options: CompactorOptions) {
    this.threshold = options.thresholdTokens ?? COMPACT_THRESHOLD_TOKENS;
    this.target = options.targetTokens ?? COMPACT_TARGET_TOKENS;
  }

  condensePrompt(memory: string): string {
    return [
      `Condense the project memory below to under ${this.target} tokens.`,
      "Preserve every decision, naming convention and node path verbatim.",
      "Drop narration, repetition and anything a reader could re-derive from the scene.",
      "Keep the markdown section structure. Answer with the condensed memory only.",
      "",
      "----",
      memory,
    ].join("\n");
  }

  /** Compact when over the threshold. Returns null when nothing needed doing. */
  async maybeCompact(store: MemoryStore): Promise<CompactionReport | null> {
    const current = await store.snapshot();
    const before = estimateTokens(current.text);
    if (before <= this.threshold) return null;
    const condensed = (await this.options.condense(this.condensePrompt(current.text))).trim();
    const empty = condensed.length === 0;
    const grew = condensed.length >= current.text.length;
    if (empty || grew) {
      throw new Error(`compaction produced ${condensed.length} chars from ${current.text.length}; memory left untouched`);
    }
    await store.replace(`${condensed}\n`);
    return { before, after: estimateTokens(condensed) };
  }
}
