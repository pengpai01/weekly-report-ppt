import type { Project, NextWeekRow, Report } from "../types";
import { createId, todayISO, defaultTitle } from "./format";

export function emptyProject(): Project {
  return { id: createId(), name: "", bullets: [""] };
}

export function emptyPlanRow(projectName = ""): NextWeekRow {
  return { id: createId(), projectName, items: [""] };
}

export function createReport(partial: Partial<Report> = {}): Report {
  const now = new Date().toISOString();
  const templateType = partial.templateType ?? "weekly";
  return {
    id: createId(),
    templateType,
    title: partial.title ?? defaultTitle(templateType),
    department: partial.department ?? "",
    date: partial.date ?? todayISO(),
    author: partial.author ?? "",
    projects: partial.projects ?? [emptyProject()],
    issues: partial.issues ?? { empty: true, items: [] },
    nextWeek: partial.nextWeek ?? [],
    slides: partial.slides ?? [],
    status: partial.status ?? "draft",
    createdAt: partial.createdAt ?? now,
    updatedAt: now,
  };
}

export function continueFrom(source: Report): Report {
  return createReport({
    templateType: source.templateType,
    title: source.title,
    department: source.department,
    author: source.author,
    projects: source.projects.map((p) => ({
      id: createId(),
      name: p.name,
      bullets: [""],
      status: p.status,
    })),
    issues: { empty: true, items: [] },
    nextWeek: source.projects
      .filter((p) => p.name.trim())
      .map((p) => emptyPlanRow(p.name)),
  });
}

export function canGenerate(report: Report): { ok: true } | { ok: false; message: string } {
  if (!report.department.trim()) {
    return { ok: false, message: "请填写部门" };
  }
  if (!report.date) {
    return { ok: false, message: "请填写日期" };
  }
  const named = report.projects.filter((p) => p.name.trim());
  if (named.length === 0) {
    return { ok: false, message: "请至少添加 1 个项目" };
  }
  const missingBullets = named.filter(
    (p) => p.bullets.map((b) => b.trim()).filter(Boolean).length === 0,
  );
  if (missingBullets.length) {
    return {
      ok: false,
      message: `「${missingBullets[0].name}」请至少填写 1 条进展要点`,
    };
  }
  return { ok: true };
}

export const STATUS_LABEL: Record<Report["status"], string> = {
  draft: "草稿",
  generated: "已生成",
  exported: "已导出",
};
