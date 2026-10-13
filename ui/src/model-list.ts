import type { ModelKey, ModelRef } from "@houdini-pi/protocol";

/** One block of the model picker: an optional heading over its models. */
export interface ModelSection {
  title: string | undefined;
  models: ModelRef[];
}

export const sameModel = (a: ModelKey | undefined, b: ModelKey | undefined): boolean =>
  a !== undefined && b !== undefined && a.provider === b.provider && a.id === b.id;

export function matchesQuery(model: ModelRef, query: string): boolean {
  const haystack = `${model.provider} ${model.name} ${model.id}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .every((word) => haystack.includes(word));
}

/**
 * The picker's list, in the order the artist reads it:
 *
 *   1. the selected model, alone and unheaded, so "what am I on" is the first line;
 *   2. Recommended: the curated models, best first, the selected one not repeated;
 *   3. All models: everything else.
 *
 * A search narrows every section rather than flattening them, so a match still says
 * whether it is recommended. Empty sections are dropped. Pure, so it is tested without a DOM.
 */
export function arrangeModels(models: ModelRef[], current: ModelKey | undefined, recommended: ModelKey[], query: string, limit = 200): ModelSection[] {
  const visible = models.filter((m) => matchesQuery(m, query));
  const selected = visible.filter((m) => sameModel(m, current));
  const picks = recommended.flatMap((key) => visible.filter((m) => sameModel(m, key) && !sameModel(m, current)));
  const rest = visible.filter((m) => !sameModel(m, current) && !picks.some((p) => sameModel(p, m))).slice(0, limit);
  const sections: ModelSection[] = [
    { title: undefined, models: selected },
    { title: "Recommended", models: picks },
    { title: "All models", models: rest },
  ];
  return sections.filter((s) => s.models.length > 0);
}

/** How a model reads in the list: the default one says so, first. */
export function modelLabel(model: ModelRef, defaultModel: ModelKey | undefined): string {
  return sameModel(model, defaultModel) ? `(Default) ${model.name}` : model.name;
}
