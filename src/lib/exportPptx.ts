/**
 * Browser PPTX export for the official week-summary layout.
 * Packaging reference: templates/week-summary-template.pptx
 * That file is in the repo as the packaging reference; this module draws slides and does not open the binary.
 * Do not copy the template closing-slide ad watermark.
 */
import PptxGenJS from "pptxgenjs";
import type {
  ClosingPayload,
  CoverPayload,
  IssuesPayload,
  PartPayload,
  PlanPayload,
  ProjectPayload,
  Report,
  Slide,
  TocPayload,
} from "../types";
import { PROJECT_STATUS_LABEL } from "../types";
import { compactDate } from "./format";

export const THEME = {
  navy: "0B2A4A",
  navyDeep: "071C31",
  navyBar: "0E3358",
  blue: "0F4C81",
  blueMid: "1A6BB5",
  accent: "2B8CDB",
  gold: "C4A35A",
  goldSoft: "E8D5A3",
  light: "F4F7FB",
  pale: "E8F1FA",
  white: "FFFFFF",
  text: "1A2332",
  muted: "5C6B7A",
  line: "D7E2EC",
  rowAlt: "F0F5FA",
  footer: "8AA0B5",
} as const;

const FONT = "Microsoft YaHei";
const W = 13.333;
const H = 7.5;
const HEADER_H = 0.86;
const GOLD_H = 0.055;

type DeckBrand = {
  department: string;
  title: string;
};

function as<T>(payload: Slide["payload"]): T {
  return payload as T;
}

function addFooter(
  slide: PptxGenJS.Slide,
  page: number,
  total: number,
  brand?: DeckBrand,
  light = false,
) {
  const color = light ? "A8C2DC" : THEME.footer;
  const label = [brand?.department, brand?.title].filter((s) => s?.trim()).join("  ·  ");
  if (label) {
    slide.addText(label, {
      x: 0.42,
      y: H - 0.4,
      w: 9.4,
      h: 0.26,
      fontFace: FONT,
      fontSize: 10,
      color,
      margin: 0,
    });
  }
  slide.addText(`${String(page).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, {
    x: W - 1.85,
    y: H - 0.4,
    w: 1.45,
    h: 0.26,
    fontFace: FONT,
    fontSize: 10,
    color,
    align: "right",
    margin: 0,
  });
}

function addTopBar(
  slide: PptxGenJS.Slide,
  title: string,
  opts?: { badge?: string },
) {
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: W,
    h: HEADER_H,
    fill: { color: THEME.navy },
  });
  slide.addShape("rect", {
    x: 0,
    y: HEADER_H,
    w: W,
    h: GOLD_H,
    fill: { color: THEME.gold },
  });
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: 0.1,
    h: HEADER_H,
    fill: { color: THEME.gold },
  });
  const hasBadge = Boolean(opts?.badge);
  slide.addText(title, {
    x: 0.42,
    y: 0.18,
    w: hasBadge ? 10.35 : 12.45,
    h: 0.52,
    fontFace: FONT,
    fontSize: 22,
    bold: true,
    color: THEME.white,
    valign: "middle",
    margin: 0,
  });
  if (opts?.badge) {
    slide.addShape("roundRect", {
      x: 11.05,
      y: 0.24,
      w: 1.82,
      h: 0.38,
      fill: { color: THEME.gold },
      rectRadius: 0.12,
    });
    slide.addText(opts.badge, {
      x: 11.05,
      y: 0.24,
      w: 1.82,
      h: 0.38,
      fontFace: FONT,
      fontSize: 12,
      bold: true,
      color: THEME.navyDeep,
      align: "center",
      valign: "middle",
      margin: 0,
    });
  }
}

function addContentBackdrop(slide: PptxGenJS.Slide) {
  slide.addShape("rect", {
    x: 0,
    y: HEADER_H + GOLD_H,
    w: W,
    h: H - HEADER_H - GOLD_H,
    fill: { color: THEME.light },
  });
}

function renderCover(slide: PptxGenJS.Slide, payload: CoverPayload) {
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: W,
    h: H,
    fill: { color: THEME.navyDeep },
  });
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: 0.16,
    h: H,
    fill: { color: THEME.gold },
  });
  slide.addShape("ellipse", {
    x: 10.45,
    y: -1.85,
    w: 5.1,
    h: 5.1,
    fill: { color: THEME.navy, transparency: 28 },
  });
  slide.addShape("ellipse", {
    x: 11.35,
    y: 5.05,
    w: 3.4,
    h: 3.4,
    fill: { color: THEME.blue, transparency: 48 },
  });
  slide.addShape("diamond", {
    x: 0.88,
    y: 1.42,
    w: 0.18,
    h: 0.18,
    fill: { color: THEME.gold },
  });

  const period = payload.templateType === "biweekly" ? "双周报" : "周报";
  const kicker = payload.templateType === "biweekly" ? "BIWEEKLY REPORT" : "WEEKLY REPORT";
  slide.addText(`${kicker}  ·  ${period}`, {
    x: 1.18,
    y: 1.32,
    w: 10.4,
    h: 0.36,
    fontFace: FONT,
    fontSize: 13,
    color: THEME.gold,
    charSpacing: 2,
    margin: 0,
  });
  slide.addText(payload.title, {
    x: 0.88,
    y: 1.82,
    w: 11.2,
    h: 1.15,
    fontFace: FONT,
    fontSize: 42,
    bold: true,
    color: THEME.white,
    margin: 0,
  });
  slide.addShape("rect", {
    x: 0.88,
    y: 3.08,
    w: 1.85,
    h: 0.06,
    fill: { color: THEME.gold },
  });

  slide.addShape("rect", {
    x: 0,
    y: 5.95,
    w: W,
    h: 1.55,
    fill: { color: THEME.navyBar },
  });
  slide.addShape("rect", {
    x: 0,
    y: 5.95,
    w: W,
    h: 0.045,
    fill: { color: THEME.gold },
  });

  const cells: { label: string; value: string }[] = [
    { label: "部门", value: payload.department.trim() || "—" },
    { label: "日期", value: payload.dateLabel || "—" },
  ];
  if (payload.author.trim()) {
    cells.push({ label: "汇报人", value: payload.author.trim() });
  }
  const cellW = 3.6;
  cells.forEach((cell, i) => {
    const x = 0.88 + i * (cellW + 0.35);
    slide.addText(cell.label, {
      x,
      y: 6.14,
      w: cellW,
      h: 0.28,
      fontFace: FONT,
      fontSize: 11,
      color: THEME.gold,
      margin: 0,
    });
    slide.addText(cell.value, {
      x,
      y: 6.42,
      w: cellW,
      h: 0.42,
      fontFace: FONT,
      fontSize: 18,
      bold: true,
      color: THEME.white,
      margin: 0,
    });
    if (i < cells.length - 1) {
      slide.addShape("rect", {
        x: x + cellW + 0.12,
        y: 6.28,
        w: 0.015,
        h: 0.55,
        fill: { color: "3A5A78" },
      });
    }
  });
}

function renderToc(
  slide: PptxGenJS.Slide,
  payload: TocPayload,
  page: number,
  total: number,
  brand: DeckBrand,
) {
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: 4.45,
    h: H,
    fill: { color: THEME.navy },
  });
  slide.addShape("rect", {
    x: 4.45,
    y: 0,
    w: W - 4.45,
    h: H,
    fill: { color: THEME.white },
  });
  slide.addShape("rect", {
    x: 4.45,
    y: 0,
    w: 0.08,
    h: H,
    fill: { color: THEME.gold },
  });
  slide.addShape("diamond", {
    x: 0.55,
    y: 2.05,
    w: 0.18,
    h: 0.18,
    fill: { color: THEME.gold },
  });
  slide.addText("目录", {
    x: 0.48,
    y: 2.38,
    w: 3.55,
    h: 0.7,
    fontFace: FONT,
    fontSize: 40,
    bold: true,
    color: THEME.white,
    margin: 0,
  });
  slide.addText("CONTENTS", {
    x: 0.48,
    y: 3.1,
    w: 3.55,
    h: 0.34,
    fontFace: FONT,
    fontSize: 14,
    color: THEME.gold,
    charSpacing: 3,
    margin: 0,
  });
  slide.addShape("rect", {
    x: 0.5,
    y: 3.58,
    w: 1.45,
    h: 0.05,
    fill: { color: THEME.gold },
  });

  payload.items.forEach((item, i) => {
    const y = 1.28 + i * 1.62;
    slide.addShape("roundRect", {
      x: 5.15,
      y: y + 0.08,
      w: 0.78,
      h: 0.78,
      fill: { color: THEME.gold },
      rectRadius: 0.08,
    });
    slide.addText(item.index, {
      x: 5.15,
      y: y + 0.08,
      w: 0.78,
      h: 0.78,
      fontFace: FONT,
      fontSize: 16,
      bold: true,
      color: THEME.navyDeep,
      align: "center",
      valign: "middle",
      margin: 0,
    });
    slide.addText(item.title, {
      x: 6.2,
      y: y + 0.08,
      w: 6.3,
      h: 0.42,
      fontFace: FONT,
      fontSize: 22,
      bold: true,
      color: THEME.text,
      margin: 0,
    });
    slide.addText(item.en, {
      x: 6.2,
      y: y + 0.5,
      w: 6.3,
      h: 0.28,
      fontFace: FONT,
      fontSize: 12,
      color: THEME.muted,
      margin: 0,
    });
    if (i < payload.items.length - 1) {
      slide.addShape("rect", {
        x: 5.15,
        y: y + 1.28,
        w: 7.35,
        h: 0.012,
        fill: { color: THEME.line },
      });
    }
  });
  addFooter(slide, page, total, brand);
}

function renderPart(slide: PptxGenJS.Slide, payload: PartPayload) {
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: W,
    h: H,
    fill: { color: THEME.navy },
  });
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: 0.16,
    h: H,
    fill: { color: THEME.gold },
  });
  slide.addText(payload.partNo, {
    x: 7.2,
    y: 1.15,
    w: 5.8,
    h: 4.6,
    fontFace: FONT,
    fontSize: 160,
    bold: true,
    color: "163A5C",
    align: "right",
    valign: "middle",
    margin: 0,
  });
  slide.addText("PART", {
    x: 0.88,
    y: 2.12,
    w: 5.2,
    h: 0.3,
    fontFace: FONT,
    fontSize: 14,
    color: THEME.gold,
    charSpacing: 3,
    margin: 0,
  });
  slide.addText(payload.partNo, {
    x: 0.82,
    y: 2.4,
    w: 6.2,
    h: 1.05,
    fontFace: FONT,
    fontSize: 68,
    bold: true,
    color: THEME.white,
    margin: 0,
  });
  slide.addShape("rect", {
    x: 0.88,
    y: 3.55,
    w: 1.55,
    h: 0.055,
    fill: { color: THEME.gold },
  });
  slide.addText(payload.title, {
    x: 0.88,
    y: 3.78,
    w: 11,
    h: 0.62,
    fontFace: FONT,
    fontSize: 30,
    bold: true,
    color: THEME.white,
    margin: 0,
  });
  slide.addText(payload.en, {
    x: 0.88,
    y: 4.42,
    w: 11,
    h: 0.34,
    fontFace: FONT,
    fontSize: 15,
    color: "8FB0CC",
    margin: 0,
  });
}

function addBulletRow(
  slide: PptxGenJS.Slide,
  text: string,
  index: number,
  y: number,
  rowH: number,
) {
  slide.addShape("roundRect", {
    x: 0.45,
    y,
    w: 12.4,
    h: rowH,
    fill: { color: THEME.white },
    line: { color: THEME.line, pt: 0.75 },
    rectRadius: 0.06,
  });
  slide.addShape("rect", {
    x: 0.45,
    y,
    w: 0.08,
    h: rowH,
    fill: { color: THEME.gold },
  });
  slide.addShape("ellipse", {
    x: 0.72,
    y: y + (rowH - 0.34) / 2,
    w: 0.34,
    h: 0.34,
    fill: { color: THEME.navy },
  });
  slide.addText(String(index), {
    x: 0.72,
    y: y + (rowH - 0.34) / 2,
    w: 0.34,
    h: 0.34,
    fontFace: FONT,
    fontSize: 11,
    bold: true,
    color: THEME.white,
    align: "center",
    valign: "middle",
    margin: 0,
  });
  slide.addText(text, {
    x: 1.22,
    y: y + 0.08,
    w: 11.4,
    h: rowH - 0.16,
    fontFace: FONT,
    fontSize: rowH < 0.85 ? 13 : 15,
    color: THEME.text,
    valign: "middle",
    wrap: true,
    margin: 0,
  });
}

function renderProject(
  slide: PptxGenJS.Slide,
  payload: ProjectPayload,
  page: number,
  total: number,
  brand: DeckBrand,
) {
  const title = `${payload.ordinal}、${payload.name}${payload.continued ? "（续）" : ""}`;
  const badge = payload.status ? PROJECT_STATUS_LABEL[payload.status] : undefined;
  addTopBar(slide, title, { badge });
  addContentBackdrop(slide);

  const count = Math.max(payload.bullets.length, 1);
  const top = 1.18;
  const gap = 0.1;
  const available = 5.55;
  const rowH = Math.min(1.12, (available - gap * (count - 1)) / count);

  payload.bullets.forEach((bullet, i) => {
    const y = top + i * (rowH + gap);
    addBulletRow(slide, bullet, payload.bulletOffset + i + 1, y, rowH);
  });
  addFooter(slide, page, total, brand);
}

function renderIssues(
  slide: PptxGenJS.Slide,
  payload: IssuesPayload,
  page: number,
  total: number,
  brand: DeckBrand,
) {
  addTopBar(slide, "存在问题与建议");
  addContentBackdrop(slide);

  if (payload.empty) {
    slide.addShape("roundRect", {
      x: 3.55,
      y: 2.55,
      w: 6.2,
      h: 2.35,
      fill: { color: THEME.white },
      line: { color: THEME.gold, pt: 1.25 },
      rectRadius: 0.08,
    });
    slide.addText("N/A", {
      x: 3.55,
      y: 2.78,
      w: 6.2,
      h: 1.05,
      fontFace: FONT,
      fontSize: 48,
      bold: true,
      color: THEME.navy,
      align: "center",
      valign: "middle",
      margin: 0,
    });
    slide.addText("本期无问题与建议", {
      x: 3.55,
      y: 3.9,
      w: 6.2,
      h: 0.5,
      fontFace: FONT,
      fontSize: 15,
      color: THEME.muted,
      align: "center",
      margin: 0,
    });
  } else {
    const count = Math.max(payload.items.length, 1);
    const top = 1.18;
    const gap = 0.1;
    const available = 5.55;
    const rowH = Math.min(1.05, (available - gap * (count - 1)) / count);
    payload.items.forEach((item, i) => {
      const y = top + i * (rowH + gap);
      addBulletRow(slide, item, i + 1, y, rowH);
    });
  }
  addFooter(slide, page, total, brand);
}

function renderPlan(
  slide: PptxGenJS.Slide,
  payload: PlanPayload,
  page: number,
  total: number,
  brand: DeckBrand,
) {
  addTopBar(slide, "下周工作计划");
  addContentBackdrop(slide);

  const headerCell = {
    fill: { color: THEME.navy },
    color: THEME.white,
    bold: true,
    align: "center" as const,
    valign: "middle" as const,
  };
  const rows: PptxGenJS.TableRow[] = [
    [
      { text: "序号", options: headerCell },
      { text: "项目", options: headerCell },
      { text: "工作内容", options: headerCell },
    ],
    ...payload.rows.map((row, i) => {
      const fill = { color: i % 2 === 0 ? THEME.white : THEME.rowAlt };
      return [
        {
          text: String(i + 1),
          options: {
            fill,
            color: THEME.navy,
            bold: true,
            align: "center" as const,
            valign: "middle" as const,
          },
        },
        {
          text: row.projectName || "—",
          options: {
            fill,
            color: THEME.text,
            bold: true,
            valign: "middle" as const,
            align: "left" as const,
          },
        },
        {
          text: row.items.length ? row.items.map((t, idx) => `${idx + 1}. ${t}`).join("\n") : "—",
          options: {
            fill,
            color: THEME.text,
            valign: "middle" as const,
            align: "left" as const,
          },
        },
      ];
    }),
  ];

  slide.addTable(rows, {
    x: 0.45,
    y: 1.16,
    w: 12.4,
    h: 5.42,
    colW: [0.9, 3.3, 8.2],
    border: [
      { pt: 0.6, color: THEME.line },
      { pt: 0.6, color: THEME.line },
      { pt: 0.6, color: THEME.line },
      { pt: 0.6, color: THEME.line },
    ],
    fontFace: FONT,
    fontSize: 12,
    color: THEME.text,
    valign: "middle",
    align: "left",
  });
  addFooter(slide, page, total, brand);
}

function renderClosing(slide: PptxGenJS.Slide, payload: ClosingPayload) {
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: W,
    h: H,
    fill: { color: THEME.navyDeep },
  });
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: 0.16,
    h: H,
    fill: { color: THEME.gold },
  });
  slide.addShape("ellipse", {
    x: -1.5,
    y: 4.85,
    w: 4.1,
    h: 4.1,
    fill: { color: THEME.navy, transparency: 22 },
  });
  slide.addText("END", {
    x: 0.8,
    y: 2.05,
    w: 11.7,
    h: 0.32,
    fontFace: FONT,
    fontSize: 13,
    color: THEME.gold,
    align: "center",
    charSpacing: 4,
    margin: 0,
  });
  slide.addText(payload.message || "感谢聆听", {
    x: 0.8,
    y: 2.5,
    w: 11.7,
    h: 1,
    fontFace: FONT,
    fontSize: 44,
    bold: true,
    color: THEME.white,
    align: "center",
    margin: 0,
  });
  slide.addShape("rect", {
    x: 5.85,
    y: 3.62,
    w: 1.6,
    h: 0.055,
    fill: { color: THEME.gold },
  });
  slide.addText("Thank you", {
    x: 0.8,
    y: 3.82,
    w: 11.7,
    h: 0.38,
    fontFace: FONT,
    fontSize: 15,
    color: THEME.goldSoft,
    align: "center",
    charSpacing: 3,
    margin: 0,
  });
  if (payload.department) {
    slide.addText(payload.department, {
      x: 0.8,
      y: 6.35,
      w: 11.7,
      h: 0.3,
      fontFace: FONT,
      fontSize: 14,
      color: "8FB0CC",
      align: "center",
      margin: 0,
    });
  }
}

export function buildPresentation(report: Report): PptxGenJS {
  const pres = new PptxGenJS();
  pres.defineLayout({ name: "WIDE_16x9", width: W, height: H });
  pres.layout = "WIDE_16x9";
  pres.title = report.title;
  pres.author = report.author || report.department || "汇报助手";
  pres.subject = `${report.department} ${report.title}`.trim();
  pres.company = report.department || "汇报助手";

  const brand: DeckBrand = {
    department: report.department,
    title: report.title,
  };
  const slides = report.slides;
  const total = slides.length;

  slides.forEach((item, index) => {
    const slide = pres.addSlide();
    const page = index + 1;
    switch (item.type) {
      case "cover":
        renderCover(slide, as<CoverPayload>(item.payload));
        break;
      case "toc":
        renderToc(slide, as<TocPayload>(item.payload), page, total, brand);
        break;
      case "part":
        renderPart(slide, as<PartPayload>(item.payload));
        break;
      case "project":
        renderProject(slide, as<ProjectPayload>(item.payload), page, total, brand);
        break;
      case "issues":
        renderIssues(slide, as<IssuesPayload>(item.payload), page, total, brand);
        break;
      case "plan":
        renderPlan(slide, as<PlanPayload>(item.payload), page, total, brand);
        break;
      case "closing":
        renderClosing(slide, as<ClosingPayload>(item.payload));
        break;
    }
  });

  return pres;
}

export function exportFileName(report: Report): string {
  const dept = report.department.trim() || "部门";
  return `${dept}-${report.title}-${compactDate(report.date)}.pptx`;
}

export async function downloadPptx(report: Report): Promise<string> {
  const pres = buildPresentation(report);
  const fileName = exportFileName(report);
  await pres.writeFile({ fileName });
  return fileName;
}
