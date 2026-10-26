import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface Record_ {
  hip: string;
}

/** Read-only: which hip each conversation worked on, from before the list lived inside the hip.
 *  Kept so conversations from then still show in their scene's sessions tab. */
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

  sessionsOf(hip: string): string[] {
    return Object.entries(this.load())
      .filter(([, record]) => record.hip === hip)
      .map(([sessionPath]) => sessionPath);
  }
}
