import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createReport } from "./report";
import { generateSlides } from "./generateSlides";
import { buildPptxBytes, exportFileName, fillOfficialTemplate } from "./exportPptx";
import { SAMPLE_REPORT_SEED } from "./sampleData";
import { createId } from "./format";
import { MAX_BULLETS_PER_PAGE } from "../types";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(SRC_DIR, "../..");
const OFFICIAL_TEMPLATE = "templates/week-summary-template.pptx";
const DEPRECATED_TEMPLATE = "week-summary-software-20260911.pptx";

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

function templateBytes() {
  return readFileSync(join(ROOT_DIR, OFFICIAL_TEMPLATE));
}

async function zipSlides(report: ReturnType<typeof createReport>) {
  const template = templateBytes();
  const buf = await buildPptxBytes(report, template);
  const zip = await JSZip.loadAsync(buf);
  const templateZip = await JSZip.loadAsync(template);
  const pres = await zip.file("ppt/presentation.xml")!.async("string");
  const rels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
  const order = [...pres.matchAll(/<p:sldId id="\d+" r:id="(rId\d+)"\/>/g)].map((match) => {
    const target = new RegExp(`Id="${match[1]}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
    expect(target).toBeTruthy();
    return `ppt/${target}`;
  });
  const xml = await Promise.all(order.map((name) => zip.file(name)!.async("string")));
  return { zip, xml, templateZip };
}

function shapeBox(xml: string, includes: string): string {
  const shapes = xml.match(/<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/g) ?? [];
  const shape = shapes.find((part) => {
    const text = [...part.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map((match) => match[1]).join("");
    return text.includes(includes) || part.includes(includes);
  });
  expect(shape, includes).toBeTruthy();
  const off = /<a:off x="(\d+)" y="(\d+)"\/>/.exec(shape ?? "");
  const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(shape ?? "");
  expect(off).toBeTruthy();
  expect(ext).toBeTruthy();
  return `${off?.[1]},${off?.[2]},${ext?.[1]},${ext?.[2]}`;
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
    expect(exporter).toContain("templates/week-summary-template.pptx?url");
    expect(exporter).toContain("fillOfficialTemplate");
    expect(exporter).not.toContain("pptxgenjs");
    expect(exporter).not.toMatch(/readFile(Sync)?\(/);

    const preview = readFileSync(join(SRC_DIR, "../pages/PreviewPage.tsx"), "utf8");
    const slideView = readFileSync(join(SRC_DIR, "../components/SlideView.tsx"), "utf8");
    expect(preview).toContain("fillOfficialTemplate");
    expect(preview).toContain("TemplateSlideView");
    expect(preview).not.toContain("<SlideView");
    expect(preview).not.toContain("pptxgenjs");
    expect(slideView).not.toContain("WEEKLY REPORT");
    expect(slideView).not.toContain("pptxgenjs");
  });

  it("does not hardcode Windows drive paths in the exporter", () => {
    const src = readFileSync(join(SRC_DIR, "exportPptx.ts"), "utf8");
    expect(src).not.toMatch(/[A-Z]:\\/i);
    expect(src).not.toMatch(/F:\\|E:\\/);
  });

  it("fills the official template and drops ad watermark slides", async () => {
    const report = sampleReport();
    const { zip, xml, templateZip } = await zipSlides(report);
    expect(xml).toHaveLength(report.slides.length);

    const templateCover = await templateZip.file("ppt/slides/slide1.xml")!.async("string");
    const templateProject = await templateZip.file("ppt/slides/slide2.xml")!.async("string");
    const templateLayout = await templateZip.file("ppt/slideLayouts/slideLayout3.xml")!.async("string");
    const [cover, toc, , project1] = xml;

    expect(shapeBox(cover, "周工作总结")).toBe(shapeBox(templateCover, "AI项目总结汇报"));
    expect(shapeBox(cover, "部   门：")).toBe(shapeBox(templateCover, "部   门："));
    expect(cover).toContain("周工作总结");
    expect(cover).toContain("部   门：软件研发");
    expect(cover).toContain("日   期：2026年09月11日");
    expect(cover).not.toContain("汇 报 人");
    expect(cover).not.toContain("WEEKLY REPORT");

    expect(toc).toContain("目录");
    expect(toc).toContain("重要事项汇报");
    expect(toc).toContain("存在问题与建议");
    expect(toc).toContain("下周工作计划");

    expect(shapeBox(project1, 'type="title"')).toBe(shapeBox(templateProject, 'type="title"'));
    const left = /idx="1"[\s\S]{0,2500}?<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(
      templateLayout,
    );
    expect(left).toBeTruthy();
    expect(project1).toContain(`x="${left?.[1]}" y="${left?.[2]}"`);
    expect(project1).toContain(`cx="${left?.[3]}" cy="${left?.[4]}"`);
    expect(project1).toContain('idx="1"');
    expect(project1).toContain('idx="13"');
    expect(project1).toContain('algn="ctr"');
    expect(project1).toContain('sz="2400"');
    expect(project1).toContain("一、智能设备管理系统（已上线）");
    expect(project1).toContain("代理商库存系统");

    const issues = xml.find((part) => part.includes("N/A"));
    expect(issues).toContain("本期无问题与建议");
    expect(issues).toContain('lvl="1"');

    const plan = xml.find((part) => part.includes("集成测试与问题修复"));
    expect(plan).toBeTruthy();
    expect(plan).toContain("下周工作计划");
    expect(plan).toContain("形态学鉴定APP");
    expect(plan).toContain('lvl="0"');
    expect(plan).toContain('lvl="1"');

    const closing = xml.at(-1)!;
    const templateClosing = await templateZip.file("ppt/slides/slide3.xml")!.async("string");
    expect(closing).toContain("感谢聆听");
    expect(shapeBox(closing, "感谢聆听")).toBe(shapeBox(templateClosing, "感谢您的聆听"));
    expect(closing).not.toContain("Thank you");

    for (const name of SAMPLE_REPORT_SEED.projects.map((p) => p.name)) {
      expect(xml.join("\n")).toContain(name);
    }

    for (const name of Object.keys(zip.files)) {
      if (!/\.(xml|rels)$/i.test(name)) continue;
      const text = await zip.file(name)!.async("string");
      expect(text.toLowerCase()).not.toContain("1ppt");
      expect(text).not.toContain("第一PPT");
      expect(text).not.toContain("PPT模板下载");
    }

    const templateMedia = await templateZip.file("ppt/media/image2.jpeg")!.async("uint8array");
    const exportedMedia = await zip.file("ppt/media/image2.jpeg")!.async("uint8array");
    expect(Buffer.from(exportedMedia).equals(Buffer.from(templateMedia))).toBe(true);

    const core = await zip.file("docProps/core.xml")!.async("string");
    expect(core).toContain("周工作总结");
    expect(core).toContain("软件研发");
    expect(exportFileName(report)).toBe("软件研发-周工作总结-20260911.pptx");
  });

  it("marks biweekly covers and continues a project on the template body layout", async () => {
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
    expect(xml[0]).toContain("双周工作总结");
    expect(xml[0]).toContain("日   期：2026年09月11日");
    expect(xml[0]).not.toContain("BIWEEKLY REPORT");
    expect(xml[0]).not.toContain("汇 报 人");
    const continued = xml.find((part) => part.includes("（续）"));
    expect(continued).toBeTruthy();
    expect(continued).toContain("<a:t>g</a:t>");
    expect(continued).toContain('idx="1"');
    const issues = xml.find((part) => part.includes("联调环境不足"));
    expect(issues).toBeTruthy();
    expect(issues).not.toContain(">N/A<");
  });

  it("prints the author on the cover meta block when one is set", async () => {
    const report = sampleReport();
    report.author = "李四";
    report.slides = generateSlides(report);
    const { xml, templateZip } = await zipSlides(report);
    const templateCover = await templateZip.file("ppt/slides/slide1.xml")!.async("string");
    expect(xml[0]).toContain("汇 报 人：李四");
    expect(xml[0]).toContain("周工作总结");
    expect(xml[0]).toContain("部   门：软件研发");
    expect(xml[0]).toContain("日   期：2026年09月11日");
    expect(shapeBox(xml[0], "周工作总结")).toBe(shapeBox(templateCover, "AI项目总结汇报"));
    const meta = (xml[0].match(/<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/g) ?? []).find((part) =>
      part.includes("汇 报 人：李四"),
    );
    expect(meta).toBeTruthy();
    expect(meta).toContain('cy="820000"');
  });

  it("paints preview from the same filled template bytes as export", async () => {
    const report = sampleReport();
    const template = templateBytes();
    const { bytes, slides } = await fillOfficialTemplate(report, template);
    const exported = await buildPptxBytes(report, template);
    const filledZip = await JSZip.loadAsync(bytes);
    const exportedZip = await JSZip.loadAsync(exported);
    const filledCover = await filledZip.file("ppt/slides/slide1.xml")!.async("string");
    const exportedCover = await exportedZip.file("ppt/slides/slide1.xml")!.async("string");
    expect(filledCover).toBe(exportedCover);
    expect(slides).toHaveLength(report.slides.length);

    const texts = slides.flatMap((slide) =>
      slide.shapes.flatMap((shape) => shape.paragraphs?.map((paragraph) => paragraph.text) ?? []),
    );
    const joined = texts.join("\n");
    expect(joined).toContain("周工作总结");
    expect(joined).toContain("部   门：软件研发");
    expect(joined).toContain("一、智能设备管理系统（已上线）");
    expect(joined).toContain("代理商库存系统");
    expect(joined).not.toContain("1ppt");
    expect(joined).not.toContain("WEEKLY REPORT");

    const templateZip = await JSZip.loadAsync(template);
    const templateCover = await templateZip.file("ppt/slides/slide1.xml")!.async("string");
    const templateTitle = /<p:cNvPr id="20"[\s\S]*?<a:off x="(\d+)" y="(\d+)"\/>/.exec(templateCover);
    expect(templateTitle).toBeTruthy();
    const pres = await templateZip.file("ppt/presentation.xml")!.async("string");
    const cx = Number(/<p:sldSz\b[^>]*cx="(\d+)"/.exec(pres)?.[1]);
    const titleShape = slides[0].shapes.find((shape) =>
      shape.paragraphs?.some((paragraph) => paragraph.text.includes("周工作总结")),
    );
    expect(titleShape).toBeTruthy();
    expect(Math.abs((titleShape?.x ?? 0) - (Number(templateTitle?.[1]) * 1280) / cx)).toBeLessThan(1);

    const project = slides.find((slide) =>
      slide.shapes.some((shape) =>
        shape.paragraphs?.some((paragraph) => paragraph.text.includes("代理商库存系统")),
      ),
    );
    const bullet = project?.shapes.find((shape) =>
      shape.paragraphs?.some((paragraph) => paragraph.bullet && paragraph.text.includes("代理商库存系统")),
    );
    expect(bullet?.paragraphs?.[0].bullet).toBe(true);
    const layout = await templateZip.file("ppt/slideLayouts/slideLayout3.xml")!.async("string");
    const left = /idx="1"[\s\S]{0,2500}?<a:off x="(\d+)" y="(\d+)"\/>/.exec(layout);
    expect(left).toBeTruthy();
    expect(Math.abs((bullet?.x ?? 0) - (Number(left?.[1]) * 1280) / cx)).toBeLessThan(1);
  });
});
