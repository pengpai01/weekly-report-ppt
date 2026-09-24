import { describe, expect, it } from "vitest";
import { generateSlides, duplicateProjectNames } from "./generateSlides";
import { createReport } from "./report";
import { splitProjectsFromText } from "./splitText";
import { SAMPLE_REPORT_SEED, SAMPLE_SPLIT_TEXT } from "./sampleData";
import { createId } from "./format";
import { MAX_BULLETS_PER_PAGE, MAX_PLAN_ROWS_PER_PAGE, type PlanPayload } from "../types";

function reportFromSample() {
  return createReport({
    ...SAMPLE_REPORT_SEED,
    projects: SAMPLE_REPORT_SEED.projects.map((p) => ({ ...p, id: createId(), bullets: [...p.bullets] })),
    nextWeek: SAMPLE_REPORT_SEED.nextWeek.map((n) => ({ ...n, id: createId(), items: [...n.items] })),
  });
}

describe("generateSlides", () => {
  it("follows the PRD page mapping for the sample report", () => {
    const report = reportFromSample();
    const slides = generateSlides(report);
    const types = slides.map((s) => s.type);

    expect(types[0]).toBe("cover");
    expect(types[1]).toBe("toc");
    expect(types[2]).toBe("part");
    expect(types.slice(3, 10).every((t) => t === "project")).toBe(true);
    expect(types[10]).toBe("part");
    expect(types[11]).toBe("issues");
    expect(types[12]).toBe("part");
    expect(types[13]).toBe("plan");
    expect(types.at(-1)).toBe("closing");
    expect(slides.filter((s) => s.type === "project")).toHaveLength(7);

    const issues = slides.find((s) => s.type === "issues");
    expect(issues?.payload).toMatchObject({ empty: true });

    const planSlides = slides.filter((s) => s.type === "plan");
    expect(planSlides).toHaveLength(1);
    expect((planSlides[0].payload as PlanPayload).rows).toHaveLength(MAX_PLAN_ROWS_PER_PAGE);
  });

  it("starts a second plan page after eight next-week rows", () => {
    const report = createReport({
      department: "研发",
      projects: [{ id: "p1", name: "项目", bullets: ["进展"] }],
      nextWeek: Array.from({ length: MAX_PLAN_ROWS_PER_PAGE + 1 }, (_, i) => ({
        id: `n${i}`,
        projectName: `计划${i + 1}`,
        items: ["事项"],
      })),
    });
    const plans = generateSlides(report).filter((s) => s.type === "plan");
    expect(plans).toHaveLength(2);
    expect((plans[0].payload as PlanPayload).rows).toHaveLength(MAX_PLAN_ROWS_PER_PAGE);
    expect((plans[1].payload as PlanPayload).rows).toHaveLength(1);
  });

  it("splits a project with more than 6 bullets into a continuation page", () => {
    const report = createReport({
      department: "研发",
      projects: [
        {
          id: "p1",
          name: "超长项目",
          bullets: ["a", "b", "c", "d", "e", "f", "g"],
        },
      ],
    });
    const slides = generateSlides(report);
    const projectSlides = slides.filter((s) => s.type === "project");
    expect(projectSlides).toHaveLength(2);
    expect((projectSlides[0].payload as { bullets: string[] }).bullets).toHaveLength(MAX_BULLETS_PER_PAGE);
    expect((projectSlides[1].payload as { continued: boolean }).continued).toBe(true);
  });

  it("rejects duplicate project names via helper", () => {
    expect(duplicateProjectNames([{ name: "A" }, { name: "A" }, { name: "B" }])).toEqual(["A"]);
  });
});

describe("splitProjectsFromText", () => {
  it("splits sample-like Chinese weekly notes into project cards", () => {
    const projects = splitProjectsFromText(SAMPLE_SPLIT_TEXT);
    expect(projects.map((p) => p.name)).toEqual([
      "智能设备管理系统",
      "形态学鉴定APP",
      "数据回传",
    ]);
    expect(projects[0].bullets.length).toBeGreaterThanOrEqual(4);
    expect(projects[2].bullets.length).toBeGreaterThanOrEqual(2);
  });
});
