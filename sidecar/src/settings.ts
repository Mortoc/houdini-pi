import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface NamingSettings {
  /** "cheapest" picks the lowest-priced model pi can use; or "provider/model-id". */
  model: string;
  /** Rename after the N-th user message, for each N listed. */
  renameAtUserMessages: number[];
}

export interface Settings {
  naming: NamingSettings;
  /** Select the nodes the agent touches and steer pane tabs linked to the Pi pane at them. */
  followNodes: boolean;
  /**
   * Models for a new conversation, "provider/model-id", first available wins.
   * A resumed conversation keeps the model it was using. Empty: pi's own default.
   */
  defaultModel: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  naming: { model: "cheapest", renameAtUserMessages: [1, 5] },
  followNodes: true,
  defaultModel: [
    "openrouter/deepseek/deepseek-v4-flash-vision-exp",
    "openrouter/deepseek/deepseek-v4.1-flash",
    "openrouter/google/gemini-3.1-flash-lite",
  ],
};

export const SETTINGS_FILE = join(homedir(), ".houdini-pi", "settings.json");

/** ~/.houdini-pi/settings.json, shallow-merged over the defaults. A corrupt file is an error, not a silent default. */
export function loadSettings(file = SETTINGS_FILE): Settings {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_SETTINGS;
    throw error;
  }
  let parsed: Partial<Settings>;
  try {
    parsed = JSON.parse(raw) as Partial<Settings>;
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`);
  }
  const defaultModel = parsed.defaultModel === undefined ? DEFAULT_SETTINGS.defaultModel : Array.isArray(parsed.defaultModel) ? parsed.defaultModel : [parsed.defaultModel as unknown as string];
  return { naming: { ...DEFAULT_SETTINGS.naming, ...(parsed.naming ?? {}) }, followNodes: parsed.followNodes ?? DEFAULT_SETTINGS.followNodes, defaultModel };
}
