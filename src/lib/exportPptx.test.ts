import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createReport } from "./report";
import { generateSlides } from "./generateSlides";
import { buildPresentation, exportFileName } from "./exportPptx";
import { SAMPLE_REPORT_SEED } from "./sampleData";
import { createId } from "./format";

describe("pptx export", () => {
  it("builds a real pptx zip with the expected slide count and no ad watermark", async () => {
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

    const pres = buildPresentation(report);
    const buf = await pres.write({ outputType: "nodebuffer" });
    const zip = await JSZip.loadAsync(buf as Buffer);
    const slideFiles = Object.keys(zip.files).filter((n) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(n),
    );
    expect(slideFiles.length).toBe(report.slides.length);

    const xmlParts = await Promise.all(
      slideFiles.map((name) => zip.file(name)!.async("string")),
    );
    const joined = xmlParts.join("\n");
    expect(joined).toContain("周工作总结");
    expect(joined).toContain("智能设备管理系统");
    expect(joined).toContain("感谢聆听");
    expect(joined).toContain("N/A");
    expect(joined).not.toContain("1ppt.com");
    expect(joined).not.toContain("PPT模板下载");

    expect(exportFileName(report)).toBe("软件研发-周工作总结-20260911.pptx");
  });
});
