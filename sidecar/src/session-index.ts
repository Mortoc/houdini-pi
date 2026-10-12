import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Which pi session belongs to which .hip, so reopening a scene resumes its conversation. */
export class SessionIndex {
  constructor(readonly file = join(homedir(), ".houdini-pi", "sessions.json")) {}

  static keyFor(hipPath: string): string {
    return createHash("sha256").update(hipPath).digest("hex").slice(0, 16);
  }

  private load(): Record<string, string> {
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as Record<string, string>;
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      if (missing) return {};
      throw new Error(`${this.file} is unreadable: ${(error as Error).message}`);
    }
  }

  get(hipPath: string): string | undefined {
    return this.load()[SessionIndex.keyFor(hipPath)];
  }

  set(hipPath: string, sessionPath: string) {
    const index = this.load();
    index[SessionIndex.keyFor(hipPath)] = sessionPath;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify(index, null, 2)}\n`);
  }
}
