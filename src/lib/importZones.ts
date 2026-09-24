import type { MergeLine, ProjectStatus } from "../types";
import { createId } from "./format";
import type { ZoneSnapshot } from "./zoneMerge";

/**
 * Client preview of server `mapYunxiaoItemsToReport` (server/yunxiao.js).
 * Confirm still posts to the API. If the user has not edited this preview,
 * the server result is authoritative (including upload dedupe).
 *
 * Wire field is `moduleAutoMerge` (default true) on import/confirm.
 * false still groups an exact module label, and skips similar-name merge
 * (短名 ⊂ 长名 keeps the longer name only when the flag is true).
 */
export type PreviewInput = {
  id?: string;
  /** Spreadsheet 来源ID. Falls back to `id` (Yunxiao work item id). */
  sourceId?: string;
  title: string;
  status?: string;
  category?: string;
  module?: string;
  assignee?: string;
  detail?: string;
};

const PROJECT_NAME_MERGE_SUFFIXES = ["管理", "系统", "平台", "软件", "模块"];
const PROJECT_NAME_SUFFIX_RE = new RegExp(`(?:${PROJECT_NAME_MERGE_SUFFIXES.join("|")})+$`);

function normalizeProjectNameForMerge(name: string): string {
  return name.trim().replace(PROJECT_NAME_SUFFIX_RE, "");
}

function projectNamesShouldMerge(left: string, right: string): boolean {
  const a = normalizeProjectNameForMerge(left);
  const b = normalizeProjectNameForMerge(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

function resolveProjectName(title: string, module?: string): string {
  const cleaned = module?.trim() ?? "";
  if (cleaned) {
    const only = cleaned.match(/^【([^】]+)】$/);
    const name = (only ? only[1] : cleaned).trim();
    if (name) return name;
  }
  const match = String(title || "").match(/【([^】]+)】/);
  return match?.[1]?.trim() || "其他";
}

function isCancelled(status: string): boolean {
  return /已取消|取消|作废|won't\s*do|wont\s*do|rejected|拒绝/.test(status.toLowerCase());
}

function isBlocked(status: string): boolean {
  return /阻塞|已阻塞|blocked|挂起|暂停/.test(status.toLowerCase());
}

function isDone(status: string): boolean {
  const raw = status.trim();
  if (raw === "已完成" || raw === "完成") return true;
  const text = raw.toLowerCase();
  if (/未完成|未关闭/.test(text)) return false;
  return /已完成|完成|已关闭|关闭|已解决|已发布|已上线|done|closed|resolved|finished|launched/.test(text);
}

function isInProgress(status: string): boolean {
  const raw = status.trim();
  if (raw === "进行中" || raw === "处理中") return true;
  return /进行中|处理中|开发中|实现中|修复中|in.?progress|doing|active/.test(raw.toLowerCase());
}

function classify(item: PreviewInput): "skip" | "issues" | "projects" | "nextWeek" {
  const status = item.status || "";
  const category = String(item.category || "").toLowerCase();
  if (isCancelled(status)) return "skip";
  const bug =
    category === "bug" ||
    category.includes("缺陷") ||
    /bug|缺陷/i.test(item.title || "") ||
    /bug|缺陷/i.test(status);
  if (bug || isBlocked(status)) return "issues";
  if (isDone(status) || isInProgress(status)) return "projects";
  return "nextWeek";
}

function fullText(item: PreviewInput): string {
  const title = item.title?.trim() || "";
  const detail = item.detail?.trim() || "";
  if (title && detail) return `${title}\n${detail}`;
  return title || detail || item.id || "";
}

function formatBullet(item: PreviewInput): string {
  const parts = [item.status?.trim(), item.assignee?.trim()].filter(Boolean) as string[];
  const prefix = parts.length ? `[${parts.join("·")}] ` : "";
  return `${prefix}${fullText(item)}`;
}

function projectStatusFor(statuses: string[]): ProjectStatus {
  return statuses.some((status) => isInProgress(status)) ? "in_progress" : "launched";
}

type ProjectDraft = {
  name: string;
  bullets: string[];
  statuses: string[];
  sourceIds: string[];
  mergeLines: MergeLine[];
};

function lineMeta(item: PreviewInput, sourceId: string): MergeLine {
  return {
    text: fullText(item),
    ...(item.status?.trim() ? { statusLabel: item.status.trim() } : {}),
    ...(item.assignee?.trim() ? { owner: item.assignee.trim() } : {}),
    sourceId,
  };
}

function mergeModuleGroups(groups: Map<string, ProjectDraft>): ProjectDraft[] {
  const names = [...groups.keys()];
  const parent = names.map((_, index) => index);
  const find = (index: number): number => {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  };
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      if (!projectNamesShouldMerge(names[i], names[j])) continue;
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[rj] = ri;
    }
  }
  const merged = new Map<number, ProjectDraft>();
  for (let i = 0; i < names.length; i += 1) {
    const root = find(i);
    const draft = groups.get(names[i]);
    if (!draft) continue;
    const cluster = merged.get(root);
    if (!cluster) {
      merged.set(root, {
        name: draft.name,
        bullets: [...draft.bullets],
        statuses: [...draft.statuses],
        sourceIds: [...draft.sourceIds],
        mergeLines: [...draft.mergeLines],
      });
      continue;
    }
    if (draft.name.length > cluster.name.length) cluster.name = draft.name;
    cluster.bullets.push(...draft.bullets);
    cluster.statuses.push(...draft.statuses);
    cluster.sourceIds.push(...draft.sourceIds);
    cluster.mergeLines.push(...draft.mergeLines);
  }
  return [...merged.values()];
}

export function buildZoneSnapshot(items: PreviewInput[], moduleAutoMerge = true): ZoneSnapshot {
  const projectsByModule = new Map<string, ProjectDraft>();
  const issueItems: ZoneSnapshot["issues"]["items"] = [];
  const nextWeek: ZoneSnapshot["nextWeek"] = [];

  items.forEach((item, index) => {
    const bucket = classify(item);
    const sourceId = item.sourceId?.trim() || item.id || `row-${index + 1}`;
    if (bucket === "skip") return;
    if (bucket === "issues") {
      const title = item.title?.trim();
      issueItems.push({
        id: `issue:${sourceId}`,
        text: fullText(item),
        ...(title ? { title } : {}),
        sourceId,
        sourceIds: [sourceId],
        mergeLines: [lineMeta(item, sourceId)],
      });
      return;
    }
    if (bucket === "nextWeek") {
      nextWeek.push({
        id: `plan:${sourceId}`,
        projectName: "",
        items: [fullText(item)],
        sourceId,
        sourceIds: [sourceId],
        mergeLines: [lineMeta(item, sourceId)],
      });
      return;
    }
    const name = resolveProjectName(item.title, item.module);
    const draft: ProjectDraft = {
      name,
      bullets: [formatBullet(item)],
      statuses: [item.status || ""],
      sourceIds: [sourceId],
      mergeLines: [lineMeta(item, sourceId)],
    };
    const existing = projectsByModule.get(name);
    if (!existing) {
      projectsByModule.set(name, draft);
      return;
    }
    existing.bullets.push(...draft.bullets);
    existing.statuses.push(...draft.statuses);
    existing.sourceIds.push(...draft.sourceIds);
    existing.mergeLines.push(...draft.mergeLines);
  });

  const grouped = moduleAutoMerge ? mergeModuleGroups(projectsByModule) : [...projectsByModule.values()];
  return {
    projects: grouped.map((draft) => ({
      id: `project:${draft.sourceIds.join("+")}`,
      name: draft.name,
      bullets: draft.bullets,
      status: projectStatusFor(draft.statuses),
      ...(draft.sourceIds.length ? { sourceId: draft.sourceIds[0], sourceIds: draft.sourceIds } : {}),
      ...(draft.mergeLines.length ? { mergeLines: draft.mergeLines } : {}),
    })),
    issues: { empty: issueItems.length === 0, items: issueItems },
    nextWeek,
  };
}

export function newProject(): ZoneSnapshot["projects"][number] {
  return { id: createId(), name: "", bullets: [""] };
}

export function newIssue(): ZoneSnapshot["issues"]["items"][number] {
  return { id: createId(), text: "" };
}

export function newPlanRow(projectName = ""): ZoneSnapshot["nextWeek"][number] {
  return { id: createId(), projectName, items: [""] };
}
