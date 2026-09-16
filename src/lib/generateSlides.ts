import type { Report, Slide } from "../types";
import {
  MAX_BULLETS_PER_PAGE,
  MAX_PLAN_ROWS_PER_PAGE,
  TOC_ITEMS,
} from "../types";
import { createId, formatDateLabel, toChineseOrdinal } from "./format";

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function generateSlides(report: Report): Slide[] {
  const slides: Slide[] = [];

  slides.push({
    id: createId(),
    type: "cover",
    payload: {
      title: report.title || (report.templateType === "biweekly" ? "双周工作总结" : "周工作总结"),
      department: report.department,
      dateLabel: formatDateLabel(report.date),
      author: report.author,
      templateType: report.templateType,
    },
  });

  slides.push({
    id: createId(),
    type: "toc",
    payload: {
      items: TOC_ITEMS.map((item) => ({ ...item })),
    },
  });

  slides.push({
    id: createId(),
    type: "part",
    payload: {
      partNo: "01",
      title: "重要事项汇报",
      en: "Key Progress",
    },
  });

  report.projects.forEach((project, index) => {
    const bullets = project.bullets.map((b) => b.trim()).filter(Boolean);
    const pages = chunk(bullets.length ? bullets : ["（待补充）"], MAX_BULLETS_PER_PAGE);
    let offset = 0;
    pages.forEach((pageBullets, pageIndex) => {
      slides.push({
        id: createId(),
        type: "project",
        payload: {
          projectId: project.id,
          name: project.name || `未命名项目 ${index + 1}`,
          ordinal: toChineseOrdinal(index + 1),
          bullets: pageBullets,
          bulletOffset: offset,
          continued: pageIndex > 0,
          status: project.status,
        },
      });
      offset += pageBullets.length;
    });
  });

  slides.push({
    id: createId(),
    type: "part",
    payload: {
      partNo: "02",
      title: "存在问题与建议",
      en: "Issues & Suggestions",
    },
  });

  const issueTexts = report.issues.empty
    ? []
    : report.issues.items.map((i) => i.text.trim()).filter(Boolean);

  slides.push({
    id: createId(),
    type: "issues",
    payload: {
      empty: issueTexts.length === 0,
      items: issueTexts,
    },
  });

  slides.push({
    id: createId(),
    type: "part",
    payload: {
      partNo: "03",
      title: "下周工作计划",
      en: "Next Week Plan",
    },
  });

  const planRows = report.nextWeek
    .map((row) => ({
      projectName: row.projectName.trim(),
      items: row.items.map((i) => i.trim()).filter(Boolean),
    }))
    .filter((row) => row.projectName || row.items.length);

  const planPages = chunk(
    planRows.length ? planRows : [{ projectName: "待补充", items: ["请在预览中填写下周计划"] }],
    MAX_PLAN_ROWS_PER_PAGE,
  );

  for (const rows of planPages) {
    slides.push({
      id: createId(),
      type: "plan",
      payload: { rows },
    });
  }

  slides.push({
    id: createId(),
    type: "closing",
    payload: {
      message: "感谢聆听",
      department: report.department,
    },
  });

  return slides;
}

export function duplicateProjectNames(projects: { name: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const p of projects) {
    const name = p.name.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name);
}
