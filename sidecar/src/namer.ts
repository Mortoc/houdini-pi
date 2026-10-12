import type { ModelRef } from "@houdini-pi/protocol";
import type { AgentLike } from "./agent-like.js";
import type { NamingSettings } from "./settings.js";

export const DEFAULT_SESSION_NAME = "New Conversation";

/** The model that names sessions: the configured one, else the cheapest priced model available. */
export function pickNamingModel(models: ModelRef[], setting: string): ModelRef | undefined {
  if (setting !== "cheapest") {
    const [provider, ...rest] = setting.split("/");
    const id = rest.join("/");
    return models.find((m) => m.provider === provider && m.id === id);
  }
  const priced = models.filter((m) => m.cost !== undefined && m.cost.input + m.cost.output > 0);
  priced.sort((a, b) => a.cost!.input + a.cost!.output - (b.cost!.input + b.cost!.output));
  return priced[0];
}

export function shouldRename(userMessages: number, thresholds: number[]): boolean {
  return thresholds.includes(userMessages);
}

export function namingPrompt(transcript: { role: string; text: string }[]): string {
  const lines = transcript.slice(-10).map((m) => `${m.role}: ${m.text.slice(0, 400)}`);
  return [
    "Name this Houdini session in at most five words, title case, no quotes, no trailing punctuation.",
    "Name what the artist is doing, not what the assistant said.",
    "",
    ...lines,
  ].join("\n");
}

export function cleanName(raw: string): string {
  const first = raw.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return first.replace(/^["'`]+|["'`.]+$/g, "").slice(0, 60);
}

export class SessionNamer {
  private model: ModelRef | undefined | null = null;

  constructor(private readonly agent: AgentLike, private readonly settings: NamingSettings) {}

  private async namingModel(): Promise<ModelRef | undefined> {
    if (this.model === null) this.model = pickNamingModel(await this.agent.getAvailableModels(), this.settings.model);
    return this.model;
  }

  /** Rename when the user-message count hits a threshold. Returns the new name, or undefined when nothing changed. */
  async maybeRename(): Promise<string | undefined> {
    const history = this.agent.getHistory();
    const userMessages = history.filter((m) => m.role === "user").length;
    if (!shouldRename(userMessages, this.settings.renameAtUserMessages)) return undefined;
    const model = await this.namingModel();
    if (model === undefined) throw new Error(`no model to name sessions with (setting: ${this.settings.model})`);
    const name = cleanName(await this.agent.complete(model, namingPrompt(history)));
    if (name.length === 0) return undefined;
    this.agent.setSessionName(name);
    return name;
  }
}
