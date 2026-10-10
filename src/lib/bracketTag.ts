/** First non-empty paired 【…】. Callers must not write this into projects[]. */

export const UNTAGGED_LABEL = "未分类";

const PAIRED_BRACKET = /【([^】]*)】/g;

export function firstBracketTag(value: unknown): string | null {
  const text = String(value ?? "");
  for (const match of text.matchAll(PAIRED_BRACKET)) {
    const tag = match[1]?.trim() ?? "";
    if (tag) return tag;
  }
  return null;
}

/** Body first. `title` is only a fallback so older items that stored 【】 there still group. */
export function issueDisplayTag(item: { title?: string; text?: string }): string {
  return firstBracketTag(item.text) ?? firstBracketTag(item.title) ?? UNTAGGED_LABEL;
}

/** Body first, so a hand-edited projectName does not move the row to another group. */
export function nextWeekDisplayTag(item: { projectName?: string; items?: readonly string[] }): string {
  return firstBracketTag((item.items ?? []).join("\n")) ?? firstBracketTag(item.projectName) ?? UNTAGGED_LABEL;
}

/**
 * Value to store in a next-week row's `projectName`.
 * Blank body returns null so an empty row keeps its current name.
 * Otherwise the first 【…】, or 未分类 when the body has text but no pair.
 */
export function nextWeekProjectNameFromItems(items: readonly string[] | undefined): string | null {
  const body = (items ?? []).join("\n");
  if (!body.trim()) return null;
  return firstBracketTag(body) ?? UNTAGGED_LABEL;
}

/**
 * Load keeps a non-empty projectName when the body has no 【】 (older rows, sample data, names carried in).
 * Editing the body always writes the extracted name, or 未分类 when the text has no pair.
 */
export function applyNextWeekProjectName<T extends { projectName: string; items?: readonly string[] }>(
  row: T,
  mode: "load" | "edit",
): T {
  const projectName = nextWeekProjectNameFromItems(row.items);
  if (projectName == null) return row;
  if (mode === "load" && projectName === UNTAGGED_LABEL && row.projectName.trim()) return row;
  if (row.projectName === projectName) return row;
  return { ...row, projectName };
}

/** Groups keep first-seen tag order and the original item order inside each tag. */
export function groupByDisplayTag<T>(items: readonly T[], tagOf: (item: T) => string): { tag: string; items: T[] }[] {
  const groups: { tag: string; items: T[] }[] = [];
  const index = new Map<string, number>();
  for (const item of items) {
    const tag = tagOf(item);
    const found = index.get(tag);
    if (found == null) {
      index.set(tag, groups.length);
      groups.push({ tag, items: [item] });
    } else {
      groups[found].items.push(item);
    }
  }
  return groups;
}
