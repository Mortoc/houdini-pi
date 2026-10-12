/**
 * Answers the artist reads: Markdown from `present_answer`, with `houdini://`
 * links that the pane renders as buttons.
 */

export const ACTION_KINDS = ["select", "parm", "network", "pane", "help"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export interface ActionLink {
  kind: ActionKind;
  value: string;
  href: string;
}

const LINK = /houdini:\/\/([a-z]+)\?([a-z]+)=([^)\s"'<>]+)/g;
const PARAM_FOR: Record<ActionKind, string> = { select: "path", parm: "path", network: "path", pane: "type", help: "page" };

/** Every well-formed action link in the Markdown, in order, de-duplicated by href. */
export function actionLinks(markdown: string): ActionLink[] {
  const found = new Map<string, ActionLink>();
  for (const match of markdown.matchAll(LINK)) {
    const [href, kind, param, raw] = match as unknown as [string, string, string, string];
    const is_known = (ACTION_KINDS as readonly string[]).includes(kind) && PARAM_FOR[kind as ActionKind] === param;
    if (!is_known || found.has(href)) continue;
    found.set(href, { kind: kind as ActionKind, value: decodeURIComponent(raw), href });
  }
  return [...found.values()];
}

const QUESTION_OPENERS = /^(how|what|why|where|which|when|who|can|could|should|is|are|does|do|did|explain|describe|tell me|help me understand|what's|whats)\b/i;

/** Whether a prompt asks for an explanation rather than a change to the scene. */
export function isQuestion(prompt: string): boolean {
  const text = prompt.trim();
  const asks = /\?\s*$/.test(text.split("\n")[0] ?? "") || /\?/.test(text.slice(0, 200));
  return asks || QUESTION_OPENERS.test(text);
}

export const ANSWER_NUDGE =
  "The artist asked a question. Answer it with the present_answer tool: clean Markdown, steps as a numbered list, and houdini:// links (select, parm, network, pane, help) on the things each step points at. Do not answer in plain text.";
