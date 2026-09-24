import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createReport } from "./report";
import { generateSlides } from "./generateSlides";
import { buildPresentation, exportFileName } from "./exportPptx";
import { SAMPLE_REPORT_SEED } from "./sampleData";
import { createId } from "./format";
import { MAX_BULLETS_PER_PAGE, MAX_PLAN_ROWS_PER_PAGE } from "../types";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(SRC_DIR, "../..");
const OFFICIAL_TEMPLATE = "templates/week-summary-template.pptx";
const DEPRECATED_TEMPLATE = "week-summary-software-20260911.pptx";
const EMU_PER_INCH = 914400;

function sampleReport() {
  const report = createReport({
    ...SAMPLE_REPORT_SEED,
    projects: SAMPLE_REPORT_SEED.projects.map((p) => ({
      ...p,
      id: createId(),
      bullets: [...p.bullets],
    })),
    nextWeek: SAMPLE_REPORT_SEED.nextWeek.map((n) => ({
      ...n,
      id: createId(),
      items: [...n.items],
    })),
  });
  report.slides = generateSlides(report);
  return report;
}

async function zipSlides(report: ReturnType<typeof createReport>) {
  const pres = buildPresentation(report);
  const buf = await pres.write({ outputType: "nodebuffer" });
  const zip = await JSZip.loadAsync(buf as Buffer);
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(/slide(\d+)\.xml/.exec(a)?.[1] ?? 0);
      const nb = Number(/slide(\d+)\.xml/.exec(b)?.[1] ?? 0);
      return na - nb;
    });
  const xml = await Promise.all(names.map((name) => zip.file(name)!.async("string")));
  return { zip, xml, pres };
}

function tableBottomEmu(slideXml: string): number {
  const frame = /<p:graphicFrame>[\s\S]*?<a:off x="\d+" y="(\d+)"\/><a:ext cx="\d+" cy="(\d+)"\/>/.exec(
    slideXml,
  );
  expect(frame).toBeTruthy();
  return Number(frame?.[1]) + Number(frame?.[2]);
}

function shapeTopEmu(slideXml: string, text: string): number {
  const block = slideXml.split("<p:sp>").find((part) => part.includes(text));
  const y = /<a:off x="\d+" y="(\d+)"\/>/.exec(block ?? "");
  expect(y).toBeTruthy();
  return Number(y?.[1]);
}

describe("pptx export", () => {
  it("documents the official template path and drops the 20260911 sample", () => {
    const templates = readFileSync(join(ROOT_DIR, "templates/README.md"), "utf8");
    const readme = readFileSync(join(ROOT_DIR, "README.md"), "utf8");
    const exporter = readFileSync(join(SRC_DIR, "exportPptx.ts"), "utf8");
    const slides = readFileSync(join(SRC_DIR, "generateSlides.ts"), "utf8");

    for (const src of [templates, readme, exporter, slides]) {
      expect(src).toContain(OFFICIAL_TEMPLATE);
    }
    for (const src of [templates, exporter, slides]) {
      expect(src).not.toMatch(/[A-Z]:\\/);
    }
    expect(templates).toContain("已废弃");
    expect(templates).toContain(DEPRECATED_TEMPLATE);
    expect(templates).not.toContain("仓库里目前没有");
    expect(readme).not.toContain(DEPRECATED_TEMPLATE);
    expect(readme).not.toContain("仓库未附带");
    expect(exporter).not.toContain(DEPRECATED_TEMPLATE);
    expect(slides).not.toContain(DEPRECATED_TEMPLATE);
    expect(existsSync(join(ROOT_DIR, OFFICIAL_TEMPLATE))).toBe(true);
    expect(exporter).not.toMatch(/readFile(Sync)?\(/);
  });

  it("does not hardcode Windows drive paths in the exporter", () => {
    const src = readFileSync(join(SRC_DIR, "exportPptx.ts"), "utf8");
    expect(src).not.toMatch(/[A-Z]:\\/i);
    expect(src).not.toMatch(/F:\\|E:\\/);
  });

  it("builds the official week-summary page set without ad watermarks", async () => {
    const report = sampleReport();
    const { zip, xml } = await zipSlides(report);
    expect(xml).toHaveLength(report.slides.length);
    expect(report.slides.map((s) => s.type)).toEqual([
      "cover",
      "toc",
      "part",
      "project",
      "project",
      "project",
      "project",
      "project",
      "project",
      "project",
      "part",
      "issues",
      "part",
      "plan",
      "closing",
    ]);

    const [cover, toc, part1, project1, , , , , , , part2, issues, part3, plan, closing] = xml;
    expect(cover).toContain("WEEKLY REPORT");
    expect(cover).toContain("周报");
    expect(cover).toContain("周工作总结");
    expect(cover).toContain("部门");
    expect(cover).toContain("软件研发");
    expect(cover).toContain("日期");
    expect(cover).toContain("2026年09月11日");

    expect(toc).toContain("目录");
    expect(toc).toContain("CONTENTS");
    expect(toc).toContain("重要事项汇报");
    expect(toc).toContain("存在问题与建议");
    expect(toc).toContain("下周工作计划");

    expect(part1).toContain("PART");
    expect(part1).toContain("01");
    expect(part1).toContain("重要事项汇报");
    expect(project1).toContain("智能设备管理系统");
    expect(project1).toContain("已上线");
    expect(part2).toContain("02");
    expect(issues).toContain("N/A");
    expect(issues).toContain("本期无问题与建议");
    expect(part3).toContain("03");
    expect(plan).toContain("序号");
    expect(plan).toContain("项目");
    expect(plan).toContain("工作内容");
    expect(plan).toContain("形态学鉴定APP");
    expect(plan.match(/<a:tr\b/g)).toHaveLength(MAX_PLAN_ROWS_PER_PAGE + 1);
    const footerTop = shapeTopEmu(plan, "软件研发");
    expect(footerTop - tableBottomEmu(plan)).toBeGreaterThan(0.2 * EMU_PER_INCH);
    expect(closing).toContain("感谢聆听");
    expect(closing).toContain("Thank you");
    expect(closing).not.toContain("1ppt.com");

    for (const name of SAMPLE_REPORT_SEED.projects.map((p) => p.name)) {
      expect(xml.join("\n")).toContain(name);
    }

    const joined = xml.join("\n");
    expect(joined).not.toContain("1ppt.com");
    expect(joined).not.toContain("PPT模板下载");
    expect(joined).not.toContain("第一PPT");
    expect(joined).not.toContain("www.1ppt.cn");
    expect(joined).not.toMatch(/[A-Z]:\\/i);

    const core = await zip.file("docProps/core.xml")!.async("string");
    expect(core).toContain("周工作总结");
    expect(core).toContain("软件研发");

    expect(exportFileName(report)).toBe("软件研发-周工作总结-20260911.pptx");
  });

  it("marks biweekly covers and continues bullet numbers after a split page", async () => {
    const report = createReport({
      templateType: "biweekly",
      title: "双周工作总结",
      department: "软件研发",
      date: "2026-09-11",
      projects: [
        {
          id: "p1",
          name: "超长项目",
          bullets: ["a", "b", "c", "d", "e", "f", "g"],
        },
      ],
      issues: { empty: false, items: [{ id: "i1", text: "联调环境不足" }] },
    });
    report.slides = generateSlides(report);
    const projectSlides = report.slides.filter((s) => s.type === "project");
    expect(projectSlides).toHaveLength(2);
    expect((projectSlides[0].payload as { bullets: string[] }).bullets).toHaveLength(MAX_BULLETS_PER_PAGE);

    const { xml } = await zipSlides(report);
    expect(xml[0]).toContain("BIWEEKLY REPORT");
    expect(xml[0]).toContain("双周报");
    expect(xml[0]).not.toContain("汇报人");
    const continued = xml.find((part) => part.includes("（续）"));
    expect(continued).toBeTruthy();
    expect(continued).toContain("7");
    const issues = xml.find((part) => part.includes("存在问题与建议") && part.includes("联调环境不足"));
    expect(issues).toBeTruthy();
    expect(issues).not.toContain("N/A");
  });

  it("prints the author on the cover when one is set", async () => {
    const report = sampleReport();
    report.author = "李四";
    report.slides = generateSlides(report);
    const { xml } = await zipSlides(report);
    expect(xml[0]).toContain("汇报人");
    expect(xml[0]).toContain("李四");
    expect(xml[0]).toContain("周工作总结");
    expect(xml[0]).toContain("软件研发");
    expect(xml[0]).toContain("2026年09月11日");
  });
});
