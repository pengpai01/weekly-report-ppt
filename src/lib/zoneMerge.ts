import type { IssueItem, NextWeekRow, Project, ProjectStatus } from "../types";
import { createId } from "./format";

export type MergeZone = "projects" | "issues" | "nextWeek";

export type ZoneSnapshot = {
  projects: Project[];
  issues: { empty: boolean; items: IssueItem[] };
  nextWeek: NextWeekRow[];
};

export type ZoneSelection = {
  zone: MergeZone | null;
  ids: string[];
};

export const EMPTY_SELECTION: ZoneSelection = { zone: null, ids: [] };

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

/**
 * Combine titles: identical or contained names keep the longer formal name;
 * otherwise join distinct titles with 「、」.
 */
export function combineTitles(titles: string[]): string {
  let result = "";
  for (const raw of titles) {
    const next = raw.trim();
    if (!next) continue;
    if (!result) {
      result = next;
      continue;
    }
    if (result === next || result.includes(next)) continue;
    if (next.includes(result)) {
      result = next;
      continue;
    }
    result = `${result}、${next}`;
  }
  return result;
}

/** Append body lines in order, dropping blanks and exact duplicates. */
export function appendBodies(groups: string[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const raw of group) {
      const text = raw.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
    }
  }
  return out;
}

function projectStatus(items: Project[]): ProjectStatus | undefined {
  if (items.some((item) => item.status === "in_progress")) return "in_progress";
  return items.find((item) => item.status)?.status;
}

function assertSameZone(found: number, requested: number) {
  if (found < 2) throw new Error("请在同一分区至少选择 2 条");
  if (found !== requested) throw new Error("只能合并同一分区内的条目");
}

/**
 * Merge selected rows inside one zone. Other zones are copied through.
 * The merged row replaces the earliest selected row and stays editable.
 */
export function mergeZoneItems(snapshot: ZoneSnapshot, zone: MergeZone, ids: string[]): ZoneSnapshot {
  const idSet = new Set(ids);
  if (idSet.size < 2) throw new Error("请在同一分区至少选择 2 条");

  if (zone === "projects") {
    const picked = snapshot.projects.filter((item) => idSet.has(item.id));
    assertSameZone(picked.length, idSet.size);
    const firstIndex = snapshot.projects.findIndex((item) => idSet.has(item.id));
    const bullets = appendBodies(picked.map((item) => item.bullets));
    const merged: Project = {
      id: createId(),
      name: combineTitles(picked.map((item) => item.name)),
      bullets: bullets.length ? bullets : [""],
      status: projectStatus(picked),
    };
    const projects = snapshot.projects.filter((item) => !idSet.has(item.id));
    projects.splice(firstIndex, 0, merged);
    return { ...snapshot, projects };
  }

  if (zone === "issues") {
    const picked = snapshot.issues.items.filter((item) => idSet.has(item.id));
    assertSameZone(picked.length, idSet.size);
    const firstIndex = snapshot.issues.items.findIndex((item) => idSet.has(item.id));
    const lines = appendBodies(picked.map((item) => item.text.split("\n")));
    const merged: IssueItem = { id: createId(), text: lines.join("\n") };
    const items = snapshot.issues.items.filter((item) => !idSet.has(item.id));
    items.splice(firstIndex, 0, merged);
    return { ...snapshot, issues: { empty: false, items } };
  }

  const picked = snapshot.nextWeek.filter((item) => idSet.has(item.id));
  assertSameZone(picked.length, idSet.size);
  const firstIndex = snapshot.nextWeek.findIndex((item) => idSet.has(item.id));
  const planItems = appendBodies(picked.map((item) => item.items));
  const merged: NextWeekRow = {
    id: createId(),
    projectName: combineTitles(picked.map((item) => item.projectName)),
    items: planItems.length ? planItems : [""],
  };
  const nextWeek = snapshot.nextWeek.filter((item) => !idSet.has(item.id));
  nextWeek.splice(firstIndex, 0, merged);
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
  const ids = new Set(current.zone === zone ? current.ids : []);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  const nextIds = [...ids];
  return {
    selection: { zone: nextIds.length ? zone : null, ids: nextIds },
    error: null,
  };
}

export function canMergeSelection(selection: ZoneSelection): boolean {
  return selection.zone != null && selection.ids.length >= 2;
}
