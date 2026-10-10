/** First non-empty paired 【…】. Callers must not write this into projects[]. */

import type { IssueItem, NextWeekRow } from "../types";
import { pickMergeTitle } from "./zoneMerge";

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

/** Empty or bracket-only input is 「未分类」, the same label as a missing 【】 pair. */
export function normalizePartitionName(raw: string): string {
  const name = String(raw ?? "").replace(/[【】]/g, "").trim();
  return name || UNTAGGED_LABEL;
}

export type PartitionZone = "issues" | "nextWeek";

export type PartitionSelection = {
  zone: PartitionZone | null;
  tags: string[];
  primaryTag: string | null;
};

export const EMPTY_PARTITION_SELECTION: PartitionSelection = { zone: null, tags: [], primaryTag: null };

/** Same checkbox rules as important-matter rows: one zone, first checked is 「主项」. */
export function togglePartitionSelection(
  current: PartitionSelection,
  zone: PartitionZone,
  tag: string,
): { selection: PartitionSelection; error: string | null } {
  if (current.zone && current.zone !== zone && current.tags.length > 0) {
    return { selection: current, error: "只能合并同一分区内的条目" };
  }
  const base = current.zone === zone ? current.tags : [];
  const tags = base.includes(tag) ? base.filter((item) => item !== tag) : [...base, tag];
  let primaryTag = current.zone === zone ? current.primaryTag : null;
  if (!tags.length) primaryTag = null;
  else if (!primaryTag || !tags.includes(primaryTag)) primaryTag = tags[0];
  return {
    selection: { zone: tags.length ? zone : null, tags, primaryTag },
    error: null,
  };
}

export function setPartitionPrimary(selection: PartitionSelection, tag: string): PartitionSelection {
  if (!selection.tags.includes(tag)) return selection;
  return { ...selection, primaryTag: tag };
}

export function canMergePartitions(selection: PartitionSelection): boolean {
  return selection.zone != null && selection.tags.length >= 2;
}

/** Longer name wins; equal length keeps 「主项」. Same rule as project merge. */
export function chosenPartitionName(tags: readonly string[], primaryTag: string | null): string {
  return (
    pickMergeTitle(
      tags.map((tag) => ({ id: tag, title: tag })),
      primaryTag,
    ) || UNTAGGED_LABEL
  );
}

function replacePartitionTag(text: string, fromTag: string, toTag: string): string {
  if (!fromTag || fromTag === UNTAGGED_LABEL) return text;
  return text.replace(/【([^】]*)】/g, (full, inner: string) => {
    if (inner.trim() !== fromTag) return full;
    if (toTag === UNTAGGED_LABEL) return "";
    return `【${toTag}】`;
  });
}

function prefixPartitionTag(text: string, toTag: string): string {
  if (toTag === UNTAGGED_LABEL) return text;
  const tag = `【${toTag}】`;
  if (!text.trim()) return tag;
  if (firstBracketTag(text) === toTag) return text;
  return `${tag}${text}`;
}

function retagIssue(item: IssueItem, fromTag: string, toTag: string): IssueItem {
  if (issueDisplayTag(item) !== fromTag || fromTag === toTag) return item;
  let next: IssueItem = item;
  const textTag = firstBracketTag(item.text);
  if (textTag) {
    const text = replacePartitionTag(item.text, textTag, toTag);
    next = text === item.text ? item : { ...item, text };
  } else if (firstBracketTag(item.title)) {
    const title = replacePartitionTag(item.title ?? "", firstBracketTag(item.title) as string, toTag);
    next = title === item.title ? item : { ...item, title };
  } else if (toTag !== UNTAGGED_LABEL) {
    const text = prefixPartitionTag(item.text ?? "", toTag);
    next = text === item.text ? item : { ...item, text };
  }
  if (issueDisplayTag(next) === toTag) return next;
  // A leftover title pair must not pull the row into another partition.
  const titleTag = firstBracketTag(next.title);
  if (titleTag && titleTag !== toTag) {
    const title = replacePartitionTag(next.title ?? "", titleTag, toTag);
    next = { ...next, title };
  }
  if (issueDisplayTag(next) === toTag || toTag === UNTAGGED_LABEL) return next;
  const text = prefixPartitionTag(next.text ?? "", toTag);
  return text === next.text ? next : { ...next, text };
}

function prefixFirstPlanLine(items: readonly string[], toTag: string): string[] {
  if (toTag === UNTAGGED_LABEL) return items.slice();
  const tag = `【${toTag}】`;
  if (!items.length) return [tag];
  const index = items.findIndex((line) => line.trim() !== "");
  const next = items.slice();
  if (index < 0) {
    next[0] = tag;
    return next;
  }
  if (firstBracketTag(next[index]) === toTag) return next;
  next[index] = `${tag}${next[index]}`;
  return next;
}

function retagPlanItems(items: readonly string[], fromTag: string, toTag: string): string[] {
  const replaced = items.map((line) => replacePartitionTag(line, fromTag, toTag));
  if (toTag === UNTAGGED_LABEL) return replaced;
  if (firstBracketTag(replaced.join("\n")) === toTag) return replaced;
  return prefixFirstPlanLine(replaced, toTag);
}

function retagNextWeek(row: NextWeekRow, fromTag: string, toTag: string): NextWeekRow {
  if (nextWeekDisplayTag(row) !== fromTag || fromTag === toTag) return row;
  const items = retagPlanItems(row.items, fromTag, toTag);
  const sameItems = items.length === row.items.length && items.every((line, index) => line === row.items[index]);
  if (sameItems && row.projectName === toTag) return row;
  return { ...row, projectName: toTag, items };
}

function mapPartition<T>(
  items: readonly T[],
  fromTag: string,
  toTag: string,
  tagOf: (item: T) => string,
  retag: (item: T, fromTag: string, toTag: string) => T,
): T[] {
  const to = normalizePartitionName(toTag);
  if (!fromTag || to === fromTag) return items as T[];
  let changed = false;
  const next = items.map((item) => {
    if (tagOf(item) !== fromTag) return item;
    const updated = retag(item, fromTag, to);
    if (updated !== item) changed = true;
    return updated;
  });
  return changed ? next : (items as T[]);
}

/** Issues: the 【】 group key follows the name. Untagged means the pair is removed. */
export function renameIssuePartition(items: readonly IssueItem[], fromTag: string, toTag: string): IssueItem[] {
  return mapPartition(items, fromTag, toTag, issueDisplayTag, retagIssue);
}

/** Next week: projectName and the body 【】 follow the partition name. */
export function renameNextWeekPartition(items: readonly NextWeekRow[], fromTag: string, toTag: string): NextWeekRow[] {
  return mapPartition(items, fromTag, toTag, nextWeekDisplayTag, retagNextWeek);
}

function mergeRetagged<T>(
  items: readonly T[],
  tags: readonly string[],
  primaryTag: string | null,
  tagOf: (item: T) => string,
  retag: (item: T, fromTag: string, toTag: string) => T,
): T[] {
  const chosen = new Set(tags);
  if (chosen.size < 2) return items as T[];
  const target = chosenPartitionName(tags, primaryTag);
  let changed = false;
  const next = items.map((item) => {
    const tag = tagOf(item);
    if (!chosen.has(tag) || tag === target) return item;
    const updated = retag(item, tag, target);
    if (updated !== item) changed = true;
    return updated;
  });
  return changed ? next : (items as T[]);
}

export function mergeIssuePartitions(
  items: readonly IssueItem[],
  tags: readonly string[],
  primaryTag: string | null,
): IssueItem[] {
  return mergeRetagged(items, tags, primaryTag, issueDisplayTag, retagIssue);
}

export function mergeNextWeekPartitions(
  items: readonly NextWeekRow[],
  tags: readonly string[],
  primaryTag: string | null,
): NextWeekRow[] {
  return mergeRetagged(items, tags, primaryTag, nextWeekDisplayTag, retagNextWeek);
}

/** Move a whole partition block. Item order inside each partition stays put. */
export function movePartitionItems<T>(items: readonly T[], tag: string, dir: -1 | 1, tagOf: (item: T) => string): T[] {
  const groups = groupByDisplayTag(items, tagOf);
  const index = groups.findIndex((group) => group.tag === tag);
  const target = index + dir;
  if (index < 0 || target < 0 || target >= groups.length) return items as T[];
  const next = groups.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next.flatMap((group) => group.items);
}
