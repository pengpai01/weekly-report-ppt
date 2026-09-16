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
import { compactDate } from "./format";

export const THEME = {
  navy: "0A2744",
  navyDeep: "071C31",
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

function as<T>(payload: Slide["payload"]): T {
  return payload as T;
}

function addFooter(slide: PptxGenJS.Slide, page: number, total: number, light = false) {
  slide.addText(`${page} / ${total}`, {
    x: W - 1.6,
    y: H - 0.42,
    w: 1.3,
    h: 0.28,
    fontFace: FONT,
    fontSize: 10,
    color: light ? "A8C2DC" : THEME.footer,
    align: "right",
    margin: 0,
  });
}

function addTopBar(slide: PptxGenJS.Slide, title: string) {
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: W,
    h: 0.92,
    fill: { color: THEME.navy },
  });
  slide.addShape("rect", {
    x: 0,
    y: 0.92,
    w: W,
    h: 0.06,
    fill: { color: THEME.gold },
  });
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: 0.12,
    h: 0.92,
    fill: { color: THEME.gold },
  });
  slide.addText(title, {
    x: 0.45,
    y: 0.22,
    w: 12.2,
    h: 0.5,
    fontFace: FONT,
    fontSize: 22,
    bold: true,
    color: THEME.white,
    margin: 0,
  });
}

function renderCover(pres: PptxGenJS, slide: PptxGenJS.Slide, payload: CoverPayload) {
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
    w: 0.18,
    h: H,
    fill: { color: THEME.gold },
  });
  slide.addShape("ellipse", {
    x: 10.6,
    y: -1.8,
    w: 4.8,
    h: 4.8,
    fill: { color: THEME.navy, transparency: 30 },
  });
  slide.addShape("ellipse", {
    x: 11.4,
    y: 5.2,
    w: 3.2,
    h: 3.2,
    fill: { color: THEME.blue, transparency: 45 },
  });
  slide.addText(
    payload.templateType === "biweekly" ? "BIWEEKLY REPORT" : "WEEKLY REPORT",
    {
      x: 0.85,
      y: 1.55,
      w: 10,
      h: 0.35,
      fontFace: FONT,
      fontSize: 13,
      color: THEME.gold,
      charSpacing: 4,
      margin: 0,
    },
  );
  slide.addText(payload.title, {
    x: 0.85,
    y: 2.05,
    w: 11.2,
    h: 1.1,
    fontFace: FONT,
    fontSize: 44,
    bold: true,
    color: THEME.white,
    margin: 0,
  });
  slide.addShape("rect", {
    x: 0.85,
    y: 3.28,
    w: 2.1,
    h: 0.07,
    fill: { color: THEME.gold },
  });

  const meta: string[] = [`部门：${payload.department || "—"}`, `日期：${payload.dateLabel}`];
  if (payload.author.trim()) meta.push(`汇报人：${payload.author}`);

  slide.addText(meta.join("    "), {
    x: 0.85,
    y: 5.85,
    w: 11,
    h: 0.4,
    fontFace: FONT,
    fontSize: 16,
    color: "D5E4F2",
    margin: 0,
  });
  slide.addText("内部汇报 · 请勿外传", {
    x: 0.85,
    y: 6.35,
    w: 8,
    h: 0.28,
    fontFace: FONT,
    fontSize: 12,
    color: "7F9BB8",
    margin: 0,
  });
}

function renderToc(slide: PptxGenJS.Slide, payload: TocPayload, page: number, total: number) {
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: 4.55,
    h: H,
    fill: { color: THEME.navy },
  });
  slide.addShape("rect", {
    x: 4.55,
    y: 0,
    w: W - 4.55,
    h: H,
    fill: { color: THEME.white },
  });
  slide.addShape("rect", {
    x: 4.55,
    y: 0,
    w: 0.08,
    h: H,
    fill: { color: THEME.gold },
  });
  slide.addText("目录", {
    x: 0.45,
    y: 2.35,
    w: 3.7,
    h: 0.7,
    fontFace: FONT,
    fontSize: 36,
    bold: true,
    color: THEME.white,
    margin: 0,
  });
  slide.addText("CONTENTS", {
    x: 0.45,
    y: 3.05,
    w: 3.7,
    h: 0.35,
    fontFace: FONT,
    fontSize: 14,
    color: THEME.gold,
    charSpacing: 3,
    margin: 0,
  });

  payload.items.forEach((item, i) => {
    const y = 1.35 + i * 1.55;
    slide.addText(item.index, {
      x: 5.15,
      y,
      w: 1.4,
      h: 0.7,
      fontFace: FONT,
      fontSize: 32,
      bold: true,
      color: THEME.blue,
      margin: 0,
    });
    slide.addText(item.title, {
      x: 6.7,
      y: y + 0.02,
      w: 5.8,
      h: 0.42,
      fontFace: FONT,
      fontSize: 22,
      bold: true,
      color: THEME.text,
      margin: 0,
    });
    slide.addText(item.en, {
      x: 6.7,
      y: y + 0.44,
      w: 5.8,
      h: 0.3,
      fontFace: FONT,
      fontSize: 12,
      color: THEME.muted,
      margin: 0,
    });
    if (i < payload.items.length - 1) {
      slide.addShape("rect", {
        x: 5.15,
        y: y + 1.22,
        w: 7.3,
        h: 0.015,
        fill: { color: THEME.line },
      });
    }
  });
  addFooter(slide, page, total);
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
    w: 0.18,
    h: H,
    fill: { color: THEME.gold },
  });
  slide.addText("PART", {
    x: 0.9,
    y: 2.05,
    w: 4,
    h: 0.32,
    fontFace: FONT,
    fontSize: 14,
    color: THEME.gold,
    charSpacing: 3,
    margin: 0,
  });
  slide.addText(payload.partNo, {
    x: 0.85,
    y: 2.35,
    w: 6,
    h: 1.15,
    fontFace: FONT,
    fontSize: 72,
    bold: true,
    color: THEME.white,
    margin: 0,
  });
  slide.addShape("rect", {
    x: 0.9,
    y: 3.65,
    w: 1.6,
    h: 0.06,
    fill: { color: THEME.gold },
  });
  slide.addText(payload.title, {
    x: 0.9,
    y: 3.95,
    w: 11,
    h: 0.7,
    fontFace: FONT,
    fontSize: 32,
    bold: true,
    color: THEME.white,
    margin: 0,
  });
  slide.addText(payload.en, {
    x: 0.9,
    y: 4.65,
    w: 11,
    h: 0.35,
    fontFace: FONT,
    fontSize: 16,
    color: "8FB0CC",
    margin: 0,
  });
}

function renderProject(
  slide: PptxGenJS.Slide,
  payload: ProjectPayload,
  page: number,
  total: number,
) {
  const title = `${payload.ordinal}、${payload.name}${payload.continued ? "（续）" : ""}`;
  addTopBar(slide, title);
  slide.addShape("rect", {
    x: 0,
    y: 0.98,
    w: W,
    h: H - 0.98,
    fill: { color: THEME.light },
  });

  const count = Math.max(payload.bullets.length, 1);
  const top = 1.25;
  const gap = 0.12;
  const available = 5.55;
  const rowH = Math.min(1.15, (available - gap * (count - 1)) / count);

  payload.bullets.forEach((bullet, i) => {
    const y = top + i * (rowH + gap);
    slide.addShape("roundRect", {
      x: 0.45,
      y,
      w: 12.4,
      h: rowH,
      fill: { color: THEME.white },
      rectRadius: 0.08,
      shadow: {
        type: "outer",
        color: "0A2744",
        blur: 8,
        opacity: 0.08,
        offset: 2,
      },
    });
    slide.addShape("ellipse", {
      x: 0.68,
      y: y + (rowH - 0.38) / 2,
      w: 0.38,
      h: 0.38,
      fill: { color: THEME.blue },
    });
    slide.addText(String(i + 1), {
      x: 0.68,
      y: y + (rowH - 0.38) / 2,
      w: 0.38,
      h: 0.38,
      fontFace: FONT,
      fontSize: 12,
      bold: true,
      color: THEME.white,
      align: "center",
      valign: "middle",
      margin: 0,
    });
    slide.addText(bullet, {
      x: 1.25,
      y: y + 0.08,
      w: 11.35,
      h: rowH - 0.16,
      fontFace: FONT,
      fontSize: rowH < 0.85 ? 13 : 15,
      color: THEME.text,
      valign: "middle",
      wrap: true,
      margin: 0,
    });
  });
  addFooter(slide, page, total);
}

function renderIssues(
  slide: PptxGenJS.Slide,
  payload: IssuesPayload,
  page: number,
  total: number,
) {
  addTopBar(slide, "存在问题与建议");
  slide.addShape("rect", {
    x: 0,
    y: 0.98,
    w: W,
    h: H - 0.98,
    fill: { color: THEME.light },
  });

  if (payload.empty) {
    slide.addText("N/A", {
      x: 0.5,
      y: 2.7,
      w: 12.3,
      h: 1.4,
      fontFace: FONT,
      fontSize: 64,
      bold: true,
      color: "B7C4D1",
      align: "center",
      margin: 0,
    });
    slide.addText("本期无问题与建议", {
      x: 0.5,
      y: 4.15,
      w: 12.3,
      h: 0.4,
      fontFace: FONT,
      fontSize: 16,
      color: THEME.muted,
      align: "center",
      margin: 0,
    });
  } else {
    payload.items.forEach((item, i) => {
      const y = 1.3 + i * 0.85;
      slide.addShape("roundRect", {
        x: 0.5,
        y,
        w: 12.3,
        h: 0.72,
        fill: { color: THEME.white },
        rectRadius: 0.08,
      });
      slide.addText(`${i + 1}.  ${item}`, {
        x: 0.75,
        y: y + 0.08,
        w: 11.85,
        h: 0.56,
        fontFace: FONT,
        fontSize: 16,
        color: THEME.text,
        valign: "middle",
        wrap: true,
        margin: 0,
      });
    });
  }
  addFooter(slide, page, total);
}

function renderPlan(
  slide: PptxGenJS.Slide,
  payload: PlanPayload,
  page: number,
  total: number,
) {
  addTopBar(slide, "下周工作计划");
  slide.addShape("rect", {
    x: 0,
    y: 0.98,
    w: W,
    h: H - 0.98,
    fill: { color: THEME.light },
  });

  const rows: PptxGenJS.TableRow[] = [
    [
      {
        text: "项目",
        options: {
          fill: { color: THEME.navy },
          color: THEME.white,
          bold: true,
          align: "center" as const,
          valign: "middle" as const,
        },
      },
      {
        text: "工作内容",
        options: {
          fill: { color: THEME.navy },
          color: THEME.white,
          bold: true,
          align: "center" as const,
          valign: "middle" as const,
        },
      },
    ],
    ...payload.rows.map((row, i) => [
      {
        text: row.projectName || "—",
        options: {
          fill: { color: i % 2 === 0 ? THEME.white : THEME.rowAlt },
          color: THEME.text,
          bold: true,
          valign: "middle" as const,
          align: "left" as const,
        },
      },
      {
        text: row.items.length ? row.items.map((t, idx) => `${idx + 1}. ${t}`).join("\n") : "—",
        options: {
          fill: { color: i % 2 === 0 ? THEME.white : THEME.rowAlt },
          color: THEME.text,
          valign: "middle" as const,
          align: "left" as const,
        },
      },
    ]),
  ];

  slide.addTable(rows, {
    x: 0.5,
    y: 1.25,
    w: 12.3,
    h: 5.55,
    colW: [3.6, 8.7],
    border: [
      { pt: 0.6, color: THEME.line },
      { pt: 0.6, color: THEME.line },
      { pt: 0.6, color: THEME.line },
      { pt: 0.6, color: THEME.line },
    ],
    fontFace: FONT,
    fontSize: 13,
    color: THEME.text,
    valign: "middle",
    align: "left",
  });
  addFooter(slide, page, total);
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
    w: 0.18,
    h: H,
    fill: { color: THEME.gold },
  });
  slide.addShape("ellipse", {
    x: -1.4,
    y: 4.8,
    w: 4,
    h: 4,
    fill: { color: THEME.navy, transparency: 20 },
  });
  slide.addText(payload.message || "感谢聆听", {
    x: 0.8,
    y: 2.55,
    w: 11.7,
    h: 1,
    fontFace: FONT,
    fontSize: 48,
    bold: true,
    color: THEME.white,
    align: "center",
    margin: 0,
  });
  slide.addShape("rect", {
    x: 5.85,
    y: 3.7,
    w: 1.6,
    h: 0.06,
    fill: { color: THEME.gold },
  });
  slide.addText("Thank you", {
    x: 0.8,
    y: 3.95,
    w: 11.7,
    h: 0.4,
    fontFace: FONT,
    fontSize: 16,
    color: THEME.goldSoft,
    align: "center",
    charSpacing: 3,
    margin: 0,
  });
  if (payload.department) {
    slide.addText(payload.department, {
      x: 0.8,
      y: 6.25,
      w: 11.7,
      h: 0.32,
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

  const slides = report.slides;
  const total = slides.length;

  slides.forEach((item, index) => {
    const slide = pres.addSlide();
    const page = index + 1;
    switch (item.type) {
      case "cover":
        renderCover(pres, slide, as<CoverPayload>(item.payload));
        break;
      case "toc":
        renderToc(slide, as<TocPayload>(item.payload), page, total);
        break;
      case "part":
        renderPart(slide, as<PartPayload>(item.payload));
        break;
      case "project":
        renderProject(slide, as<ProjectPayload>(item.payload), page, total);
        break;
      case "issues":
        renderIssues(slide, as<IssuesPayload>(item.payload), page, total);
        break;
      case "plan":
        renderPlan(slide, as<PlanPayload>(item.payload), page, total);
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
