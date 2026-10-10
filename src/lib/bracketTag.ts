/** First non-empty paired 【…】. Display only — callers must not write this into projects[]. */

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

export function issueDisplayTag(item: { title?: string; text?: string }): string {
  return firstBracketTag(item.title) ?? firstBracketTag(item.text) ?? UNTAGGED_LABEL;
}

export function nextWeekDisplayTag(item: { projectName?: string; items?: readonly string[] }): string {
  return firstBracketTag(item.projectName) ?? firstBracketTag((item.items ?? []).join("\n")) ?? UNTAGGED_LABEL;
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
