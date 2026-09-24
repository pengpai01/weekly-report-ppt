import type { IssueItem, MergeLine, NextWeekRow, Project } from "../types";
import { createId } from "./format";

export type MergeZone = "projects" | "issues" | "nextWeek";

export type ZoneSnapshot = {
  projects: Project[];
  issues: { empty: boolean; items: IssueItem[] };
  nextWeek: NextWeekRow[];
};

export type ZoneSelection = {
  zone: MergeZone | null;
  /** Checkbox order. Bodies are concatenated in this order, not list order. */
  ids: string[];
  /** Tie-break for equal-length titles. Defaults to the first selected id. */
  primaryId: string | null;
};

export const EMPTY_SELECTION: ZoneSelection = { zone: null, ids: [], primaryId: null };

export const ZONE_LABEL: Record<MergeZone, string> = {
  projects: "重要事项",
  issues: "存在问题与建议",
  nextWeek: "下周工作计划",
};

/** Shared by both import confirms. `zones` is sent as `materials` arrays when the user edited the preview. */
export type ImportMergeOptions = {
  moduleAutoMerge: boolean;
  zones?: ZoneSnapshot;
};

/** `issues` is the item array. An N/A zone is sent as `[]` so the draft stays empty. */
export function zonesToConfirmMaterials(zones: ZoneSnapshot) {
  return {
    projects: zones.projects,
    issues: zones.issues.empty ? [] : zones.issues.items,
    nextWeek: zones.nextWeek,
  };
}

export function sameZoneSnapshot(left: ZoneSnapshot, right: ZoneSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Confirm body options for both import flows.
 * `materials` is attached only when the preview differs from the untouched snapshot.
 * A full 「撤销本次合并」 returns to that snapshot, so confirm omits `materials`.
 * The undo stack itself is never part of this object.
 */
export function confirmMergeOptions(
  moduleAutoMerge: boolean,
  zones: ZoneSnapshot,
  baseline: ZoneSnapshot,
): ImportMergeOptions {
  if (sameZoneSnapshot(zones, baseline)) return { moduleAutoMerge };
  return { moduleAutoMerge, zones };
}

type Titled = { id: string; title: string };

/**
 * Longer trimmed formal name wins. When several share that length, use 「主项」
 * if it is one of them; otherwise the first of those names in selection order.
 */
export function pickMergeTitle(items: Titled[], primaryId?: string | null): string {
  const ranked = items
    .map((item) => ({ id: item.id, title: item.title.trim() }))
    .filter((item) => item.title);
  if (!ranked.length) return "";
  const maxLen = Math.max(...ranked.map((item) => item.title.length));
  const longest = ranked.filter((item) => item.title.length === maxLen);
  return (longest.find((item) => item.id === primaryId) ?? longest[0]).title;
}

/** `[状态·负责人]`, dropping whichever part is missing. Blank lines stay blank. */
export function prefixLine(line: string, statusLabel?: string, owner?: string): string {
  const text = line.trim();
  if (!text) return "";
  const parts = [statusLabel?.trim(), owner?.trim()].filter(Boolean);
  if (!parts.length) return text;
  const prefix = `[${parts.join("·")}] `;
  if (text.startsWith(prefix)) return text;
  return `${prefix}${text}`;
}

function prefixedLines(text: string, statusLabel?: string, owner?: string): string[] {
  return text
    .split("\n")
    .map((line) => prefixLine(line, statusLabel, owner))
    .filter((line) => line !== "");
}

function bodyLines(item: {
  mergeLines?: MergeLine[];
  bullets?: string[];
  text?: string;
  items?: string[];
  statusLabel?: string;
  owner?: string;
}): string[] {
  if (item.mergeLines?.length) {
    return item.mergeLines.flatMap((line) => prefixedLines(line.text, line.statusLabel, line.owner));
  }
  if (item.bullets) return item.bullets.flatMap((line) => prefixedLines(line, item.statusLabel, item.owner));
  if (item.text != null) return prefixedLines(item.text, item.statusLabel, item.owner);
  return (item.items ?? []).flatMap((line) => prefixedLines(line, item.statusLabel, item.owner));
}

function collectSourceIds(
  items: { sourceIds?: string[]; sourceId?: string; mergeLines?: MergeLine[] }[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id?: string) => {
    const value = id?.trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  };
  for (const item of items) {
    if (item.sourceIds?.length) item.sourceIds.forEach(push);
    else push(item.sourceId);
    item.mergeLines?.forEach((line) => push(line.sourceId));
  }
  return out;
}

function formalFallback(lines: string[]): string {
  for (const line of lines) {
    const stripped = line.trim().replace(/^\[[^\]\n]*\]\s*/, "");
    if (stripped) return stripped;
  }
  return "";
}

function issueTitle(item: IssueItem): string {
  return item.title?.trim() || formalFallback(item.text.split("\n"));
}

function planTitle(item: NextWeekRow): string {
  return item.projectName.trim() || formalFallback(item.items);
}

function orderedPick<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const picked: T[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (item) picked.push(item);
  }
  return picked;
}

function assertSameZone(found: number, requested: number) {
  if (found < 2) throw new Error("请在同一分区至少选择 2 条");
  if (found !== requested) throw new Error("只能合并同一分区内的条目");
}

function earliestIndex<T extends { id: string }>(items: T[], ids: string[]): number {
  const idSet = new Set(ids);
  return items.findIndex((item) => idSet.has(item.id));
}

/**
 * Merge selected rows inside one zone. Other zones are copied through.
 * Title uses length, then 「主项」. Bodies follow selection order.
 * The merged row stays at the earliest selected list index and stays editable.
 * Undo history is not stored on the snapshot.
 */
export function mergeZoneItems(
  snapshot: ZoneSnapshot,
  zone: MergeZone,
  ids: string[],
  primaryId?: string | null,
): ZoneSnapshot {
  const requested = new Set(ids);
  if (requested.size < 2) throw new Error("请在同一分区至少选择 2 条");

  if (zone === "projects") {
    const picked = orderedPick(snapshot.projects, ids);
    assertSameZone(picked.length, requested.size);
    const primary = picked.find((item) => item.id === primaryId) ?? picked[0];
    const lines = picked.flatMap((item) => bodyLines(item));
    const sourceIds = collectSourceIds(picked);
    const merged: Project = {
      id: createId(),
      name: pickMergeTitle(
        picked.map((item) => ({ id: item.id, title: item.name })),
        primary.id,
      ),
      bullets: lines.length ? lines : [""],
      status: primary.status,
      ...(sourceIds.length ? { sourceIds } : {}),
    };
    const projects = snapshot.projects.filter((item) => !requested.has(item.id));
    projects.splice(earliestIndex(snapshot.projects, ids), 0, merged);
    return { ...snapshot, projects };
  }

  if (zone === "issues") {
    const picked = orderedPick(snapshot.issues.items, ids);
    assertSameZone(picked.length, requested.size);
    const primary = picked.find((item) => item.id === primaryId) ?? picked[0];
    const lines = picked.flatMap((item) => bodyLines(item));
    const sourceIds = collectSourceIds(picked);
    const title = pickMergeTitle(
      picked.map((item) => ({ id: item.id, title: issueTitle(item) })),
      primary.id,
    );
    const merged: IssueItem = {
      id: createId(),
      ...(title ? { title } : {}),
      text: lines.join("\n"),
      ...(sourceIds.length ? { sourceIds } : {}),
    };
    const items = snapshot.issues.items.filter((item) => !requested.has(item.id));
    items.splice(earliestIndex(snapshot.issues.items, ids), 0, merged);
    return { ...snapshot, issues: { empty: false, items } };
  }

  const picked = orderedPick(snapshot.nextWeek, ids);
  assertSameZone(picked.length, requested.size);
  const primary = picked.find((item) => item.id === primaryId) ?? picked[0];
  const lines = picked.flatMap((item) => bodyLines(item));
  const sourceIds = collectSourceIds(picked);
  const merged: NextWeekRow = {
    id: createId(),
    projectName: pickMergeTitle(
      picked.map((item) => ({ id: item.id, title: planTitle(item) })),
      primary.id,
    ),
    items: lines.length ? lines : [""],
    ...(sourceIds.length ? { sourceIds } : {}),
  };
  const nextWeek = snapshot.nextWeek.filter((item) => !requested.has(item.id));
  nextWeek.splice(earliestIndex(snapshot.nextWeek, ids), 0, merged);
  return { ...snapshot, nextWeek };
}

export function toggleSelection(
  current: ZoneSelection,
  zone: MergeZone,
  id: string,
): { selection: ZoneSelection; error: string | null } {
  if (current.zone && current.zone !== zone && current.ids.length > 0) {
    return { selection: current, error: "只能合并同一分区内的条目" };
  }
  const base = current.zone === zone ? current.ids : [];
  const ids = base.includes(id) ? base.filter((item) => item !== id) : [...base, id];
  let primaryId = current.zone === zone ? current.primaryId : null;
  if (!ids.length) primaryId = null;
  else if (!primaryId || !ids.includes(primaryId)) primaryId = ids[0];
  return {
    selection: { zone: ids.length ? zone : null, ids, primaryId },
    error: null,
  };
}

export function setPrimary(selection: ZoneSelection, id: string): ZoneSelection {
  if (!selection.ids.includes(id)) return selection;
  return { ...selection, primaryId: id };
}

export function canMergeSelection(selection: ZoneSelection): boolean {
  return selection.zone != null && selection.ids.length >= 2;
}

/** Drop line-level status so an edited body is stored as the user left it. */
export function clearLineMeta<T extends { statusLabel?: string; owner?: string; mergeLines?: MergeLine[] }>(
  item: T,
): T {
  const next = { ...item };
  delete next.statusLabel;
  delete next.owner;
  delete next.mergeLines;
  return next;
}
