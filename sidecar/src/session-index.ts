import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface Record_ {
  hip: string;
}

/** Which hip each conversation worked on, so the sessions list can group by scene and loading one loads its hip. */
export class SessionIndex {
  constructor(readonly file = join(homedir(), ".houdini-pi", "sessions.json")) {}

  private load(): Record<string, Record_> {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, unknown>;
      // Older files mapped hip hashes to session paths; those entries have no `hip` and are dropped.
      return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "object" && v !== null && typeof (v as Record_).hip === "string")) as Record<string, Record_>;
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      if (missing) return {};
      throw new Error(`${this.file} is unreadable: ${(error as Error).message}`);
    }
  }

  hipOf(sessionPath: string): string | undefined {
    return this.load()[sessionPath]?.hip;
  }

  tag(sessionPath: string, hip: string) {
    const index = this.load();
    index[sessionPath] = { hip };
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify(index, null, 2)}\n`);
  }
}
