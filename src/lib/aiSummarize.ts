import { clearLineMeta } from "./zoneMerge";
import type { ZoneSnapshot } from "./zoneMerge";
import type { IssueItem, NextWeekRow, Project } from "../types";

/** Keep these in step with server/ai.js. The browser never sees the API key. */
export const AI_TITLE_MAX = 24;
export const AI_BULLET_MAX = 60;
export const AI_PROGRESS_BULLETS_MAX = 5;

export type AiScope = "page" | "projects" | "issues" | "nextWeek";

export type AiDiffField = {
  label: string;
  before: string;
  after: string;
};

export type AiDiffEntry = {
  key: string;
  zone: string;
  heading: string;
  fields: AiDiffField[];
};

export function clipAiText(value: unknown, max: number): string {
  const clean = String(value ?? "").replace(/\s+/g, " ").trim();
  return Array.from(clean).slice(0, max).join("");
}

function nonEmpty(lines: string[]): string[] {
  return lines.map((line) => line.trim()).filter(Boolean);
}

function applyProject(current: Project, proposed: Project | undefined): Project {
  if (!proposed) return current;
  const hadTitle = current.name.trim() !== "";
  const proposedName = clipAiText(proposed.name, AI_TITLE_MAX);
  let name = current.name;
  if (hadTitle) {
    if (proposedName) name = proposedName;
  } else if (proposedName) {
    name = proposedName;
  }

  const source = nonEmpty(current.bullets);
  let bullets = current.bullets;
  if (source.length && Array.isArray(proposed.bullets)) {
    const cap = Math.min(AI_PROGRESS_BULLETS_MAX, source.length);
    const nextBullets = proposed.bullets
      .map((line) => clipAiText(line, AI_BULLET_MAX))
      .filter(Boolean)
      .slice(0, cap);
    if (nextBullets.length) bullets = nextBullets;
  }
  const bodyChanged =
    bullets.length !== current.bullets.length ||
    bullets.some((line, index) => line !== current.bullets[index]);
  const next = { ...current, name, bullets };
  return bodyChanged ? clearLineMeta(next) : next;
}

function applyIssue(current: IssueItem, proposed: IssueItem | undefined): IssueItem {
  if (!proposed) return current;
  const hadTitle = Boolean(current.title?.trim());
  const proposedTitle = clipAiText(proposed.title ?? "", AI_TITLE_MAX);
  let title = current.title;
  if (hadTitle) {
    if (proposedTitle) title = proposedTitle;
  } else if (proposedTitle) {
    title = proposedTitle;
  }
  const hadText = Boolean(current.text.trim());
  const proposedText = clipAiText(proposed.text, AI_BULLET_MAX);
  const text = hadText ? proposedText || current.text : current.text;
  const bodyChanged = text !== current.text;
  const next = { ...current, title, text };
  return bodyChanged ? clearLineMeta(next) : next;
}

function applyNext(current: NextWeekRow, proposed: NextWeekRow | undefined): NextWeekRow {
  if (!proposed) return current;
  const hadTitle = current.projectName.trim() !== "";
  const proposedName = clipAiText(proposed.projectName, AI_TITLE_MAX);
  let projectName = current.projectName;
  if (hadTitle) {
    if (proposedName) projectName = proposedName;
  } else if (proposedName) {
    projectName = proposedName;
  }
  const source = nonEmpty(current.items);
  let items = current.items;
  if (source.length && Array.isArray(proposed.items)) {
    const nextItems = proposed.items
      .map((line) => clipAiText(line, AI_BULLET_MAX))
      .filter(Boolean)
      .slice(0, source.length);
    if (nextItems.length) items = nextItems;
  }
  const bodyChanged =
    items.length !== current.items.length || items.some((line, index) => line !== current.items[index]);
  const next = { ...current, projectName, items };
  return bodyChanged ? clearLineMeta(next) : next;
}

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/** Copy summarized titles and bullets onto the current draft. Other zones stay put. */
export function applyAiText(current: ZoneSnapshot, proposed: ZoneSnapshot, scope: AiScope): ZoneSnapshot {
  const projects =
    scope === "page" || scope === "projects"
      ? current.projects.map((item) => applyProject(item, byId(proposed.projects).get(item.id)))
      : current.projects;
  const issues =
    scope === "page" || scope === "issues"
      ? current.issues.empty
        ? current.issues
        : {
            empty: current.issues.empty,
            items: current.issues.items.map((item) => applyIssue(item, byId(proposed.issues.items).get(item.id))),
          }
      : current.issues;
  const nextWeek =
    scope === "page" || scope === "nextWeek"
      ? current.nextWeek.map((item) => applyNext(item, byId(proposed.nextWeek).get(item.id)))
      : current.nextWeek;
  return { projects, issues, nextWeek };
}

function textView(zones: ZoneSnapshot) {
  return {
    projects: zones.projects.map((item) => ({ id: item.id, name: item.name, bullets: item.bullets })),
    issues: {
      empty: zones.issues.empty,
      items: zones.issues.items.map((item) => ({ id: item.id, title: item.title ?? "", text: item.text })),
    },
    nextWeek: zones.nextWeek.map((item) => ({
      id: item.id,
      projectName: item.projectName,
      items: item.items,
    })),
  };
}

export function aiTextChanged(before: ZoneSnapshot, after: ZoneSnapshot): boolean {
  return JSON.stringify(textView(before)) !== JSON.stringify(textView(after));
}

/** Confirm is the only path that returns a snapshot. Cancel and a no-op preview return null. */
export function commitAiPreview(
  confirmed: boolean,
  current: ZoneSnapshot,
  preview: ZoneSnapshot | null,
  scope: AiScope,
): ZoneSnapshot | null {
  if (!confirmed || !preview) return null;
  const next = applyAiText(current, preview, scope);
  if (!aiTextChanged(current, next)) return null;
  return next;
}

function lineChanged(before: string[], after: string[]): boolean {
  return before.length !== after.length || before.some((line, index) => line !== after[index]);
}

export function buildAiDiff(before: ZoneSnapshot, after: ZoneSnapshot): AiDiffEntry[] {
  const rows: AiDiffEntry[] = [];
  before.projects.forEach((project, index) => {
    const next = after.projects.find((item) => item.id === project.id);
    if (!next) return;
    const fields: AiDiffField[] = [];
    if (project.name !== next.name) fields.push({ label: "标题", before: project.name, after: next.name });
    if (lineChanged(project.bullets, next.bullets)) {
      fields.push({ label: "要点", before: project.bullets.join("\n"), after: next.bullets.join("\n") });
    }
    if (fields.length) {
      rows.push({
        key: `project-${project.id}`,
        zone: "重要事项",
        heading: project.name.trim() || `项目 ${index + 1}`,
        fields,
      });
    }
  });
  if (!before.issues.empty) {
    before.issues.items.forEach((item, index) => {
      const next = after.issues.items.find((row) => row.id === item.id);
      if (!next) return;
      const fields: AiDiffField[] = [];
      if ((item.title ?? "") !== (next.title ?? "")) {
        fields.push({ label: "标题", before: item.title ?? "", after: next.title ?? "" });
      }
      if (item.text !== next.text) fields.push({ label: "要点", before: item.text, after: next.text });
      if (fields.length) {
        rows.push({
          key: `issue-${item.id}`,
          zone: "存在问题与建议",
          heading: item.title?.trim() || item.text.trim() || `问题 ${index + 1}`,
          fields,
        });
      }
    });
  }
  before.nextWeek.forEach((row, index) => {
    const next = after.nextWeek.find((item) => item.id === row.id);
    if (!next) return;
    const fields: AiDiffField[] = [];
    if (row.projectName !== next.projectName) {
      fields.push({ label: "标题", before: row.projectName, after: next.projectName });
    }
    if (lineChanged(row.items, next.items)) {
      fields.push({ label: "要点", before: row.items.join("\n"), after: next.items.join("\n") });
    }
    if (fields.length) {
      rows.push({
        key: `next-${row.id}`,
        zone: "下周工作计划",
        heading: row.projectName.trim() || `计划 ${index + 1}`,
        fields,
      });
    }
  });
  return rows;
}
