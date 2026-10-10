/**
 * @vitest-environment happy-dom
 *
 * Guard: 存在问题与建议 / 下周工作计划 must not grow a title editor again.
 * Tip 0ee015c already rendered 问题或建议 and 项目 + 工作内容, with no 标题 field.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { newIssue, newPlanRow } from "../lib/importZones";
import type { ZoneSnapshot } from "../lib/zoneMerge";
import { ZoneMergePanel } from "./ZoneMergePanel";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function readRepo(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function sliceBetween(source: string, startMarker: string, endMarker?: string): string {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`missing ${startMarker}`);
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
  if (end < 0) throw new Error(`missing ${endMarker} after ${startMarker}`);
  return source.slice(start, end);
}

/** Field markup that used to edit IssueItem.title. Longer copy such as 「标题取较长名称」 is not a field. */
const TITLE_FIELD_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'placeholder="标题"', re: /placeholder\s*=\s*["']标题["']/ },
  { name: "问题标题", re: /问题标题/ },
  { name: 'aria-label 标题', re: /aria-label\s*=\s*\{?\s*["'`]标题(?:\s|["'`]|\$\{)/ },
  { name: "<label>标题</label>", re: /<label>\s*标题\s*<\/label>/ },
  { name: "value={….title}", re: /value=\{[^}\n]*\.title/ },
];

function fieldHits(source: string): string[] {
  return TITLE_FIELD_PATTERNS.filter((pattern) => pattern.re.test(source)).map((pattern) => pattern.name);
}

const TITLE_ARIA = /^(?:问题标题|标题)(?:\s|$)/;

function titleEditorHits(root: ParentNode): string[] {
  const hits: string[] = [];
  for (const node of root.querySelectorAll("input, textarea, select")) {
    const placeholder = node.getAttribute("placeholder") ?? "";
    const aria = node.getAttribute("aria-label") ?? "";
    if (placeholder === "标题" || placeholder.startsWith("问题标题")) {
      hits.push(`${node.tagName.toLowerCase()} placeholder="${placeholder}"`);
    }
    if (TITLE_ARIA.test(aria)) hits.push(`${node.tagName.toLowerCase()} aria-label="${aria}"`);
  }
  for (const node of root.querySelectorAll("label")) {
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text === "标题" || text.startsWith("问题标题") || /^标题(?:\s|$)/.test(text)) {
      hits.push(`<label>${text}</label>`);
    }
  }
  return hits;
}

function buttons(text: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll("button")].filter((node) => node.textContent?.trim() === text) as HTMLButtonElement[];
}

function setControl(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let current: ZoneSnapshot;

function Host() {
  const [value, setValue] = useState(current);
  return (
    <ZoneMergePanel
      value={value}
      onChange={(next) => {
        current = next;
        setValue(next);
      }}
    />
  );
}

async function mount(initial: ZoneSnapshot) {
  current = initial;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<Host />);
  });
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
});

function issuesZone(): HTMLElement {
  const node = document.getElementById("merge-zone-issues");
  if (!node) throw new Error("missing issues zone");
  return node;
}

function plansZone(): HTMLElement {
  const node = document.getElementById("merge-zone-nextWeek");
  if (!node) throw new Error("missing nextWeek zone");
  return node;
}

describe("issue and next-week title editors stay gone", () => {
  it("newIssue and newPlanRow do not write title", () => {
    const issue = newIssue();
    const plan = newPlanRow();
    const named = newPlanRow("设备管理");
    expect(issue).toEqual({ id: expect.any(String), text: "" });
    expect(issue).not.toHaveProperty("title");
    expect(plan).toEqual({ id: expect.any(String), projectName: "", items: [""] });
    expect(plan).not.toHaveProperty("title");
    expect(named).toMatchObject({ projectName: "设备管理", items: [""] });
    expect(named).not.toHaveProperty("title");
  });

  it("keeps a stored title on old rows but does not render a 标题 field", async () => {
    await mount({
      projects: [{ id: "p1", name: "设备管理", bullets: ["联调"] }],
      issues: {
        empty: false,
        items: [
          { id: "i1", title: "【别的】旧标题", text: "【设备】账号锁定" },
          { id: "i2", title: "仅旧标题", text: "" },
        ],
      },
      nextWeek: [{ id: "n1", projectName: "已有计划", items: ["回归"] }],
    });
    const issues = issuesZone();
    const plans = plansZone();
    expect(titleEditorHits(issues)).toEqual([]);
    expect(titleEditorHits(plans)).toEqual([]);
    expect(issues.querySelector('input[placeholder="标题"]')).toBeNull();
    expect(plans.querySelector('input[placeholder="标题"]')).toBeNull();
    expect(issues.querySelector('[aria-label^="问题标题"]')).toBeNull();
    expect(plans.querySelector('[aria-label^="问题标题"]')).toBeNull();
    expect(issues.textContent).not.toContain("旧标题");
    expect(issues.textContent).not.toContain("仅旧标题");
    expect([...issues.querySelectorAll("input, textarea")].map((node) => (node as HTMLInputElement).value)).not.toContain(
      "仅旧标题",
    );
    expect(current.issues.items.map((item) => item.title)).toEqual(["【别的】旧标题", "仅旧标题"]);
    expect((issues.querySelector('[aria-label="问题分组 设备"] textarea') as HTMLTextAreaElement | null)?.value).toBe(
      "【设备】账号锁定",
    );
    expect((plans.querySelector('[aria-label="下周项目 1"]') as HTMLInputElement).value).toBe("已有计划");

    const issueArticle = issues.querySelector('textarea[aria-label="问题内容 2"]')!.closest("article")!;
    await act(async () => {
      buttons("删除", issueArticle)[0].click();
    });
    expect(document.querySelector('[aria-label="确认删除问题"]')?.textContent).not.toContain("仅旧标题");
    expect(current.issues.items[1]?.title).toBe("仅旧标题");
  });

  it("adding a new issue row and a new next-week row still has no 标题 field", async () => {
    const initial: ZoneSnapshot = {
      projects: [{ id: "p1", name: "设备管理", bullets: ["联调"] }],
      issues: {
        empty: false,
        items: [{ id: "i-old", title: "【别的】旧标题", text: "【设备】账号锁定" }],
      },
      nextWeek: [{ id: "n-old", projectName: "已有计划", items: ["回归"] }],
    };
    await mount(initial);
    const projects = current.projects;

    await act(async () => {
      buttons("添加一条", issuesZone())[0].click();
    });
    await act(async () => {
      buttons("添加一行", plansZone())[0].click();
    });

    expect(titleEditorHits(issuesZone())).toEqual([]);
    expect(titleEditorHits(plansZone())).toEqual([]);
    expect(issuesZone().querySelector('input[placeholder="标题"]')).toBeNull();
    expect(plansZone().querySelector('input[placeholder="标题"]')).toBeNull();
    expect(issuesZone().querySelector('[aria-label^="问题标题"]')).toBeNull();
    expect(issuesZone().querySelector('[aria-label="标题"]')).toBeNull();
    expect(issuesZone().querySelector('[aria-label^="标题"]')).toBeNull();
    expect(plansZone().querySelector('[aria-label^="问题标题"]')).toBeNull();
    expect(plansZone().querySelector('[aria-label="标题"]')).toBeNull();
    expect(plansZone().querySelector('[aria-label^="标题"]')).toBeNull();
    expect([...issuesZone().querySelectorAll("label")].map((node) => node.textContent?.trim())).not.toContain("标题");
    expect([...plansZone().querySelectorAll("label")].map((node) => node.textContent?.trim())).not.toContain("标题");

    const addedIssue = current.issues.items.find((item) => item.id !== "i-old");
    const addedPlan = current.nextWeek.find((item) => item.id !== "n-old");
    expect(addedIssue).toEqual({ id: expect.any(String), text: "" });
    expect(addedIssue).not.toHaveProperty("title");
    expect(addedPlan).toEqual({ id: expect.any(String), projectName: "", items: [""] });
    expect(addedPlan).not.toHaveProperty("title");
    expect(current.issues.items[0]?.title).toBe("【别的】旧标题");
    expect(current.projects).toBe(projects);

    await act(async () => {
      setControl(
        issuesZone().querySelector('textarea[aria-label="问题内容 2"]') as HTMLTextAreaElement,
        "【形态学】补日志",
      );
    });
    const editedIssue = current.issues.items.find((item) => item.id === addedIssue?.id);
    expect(editedIssue).toEqual({ id: addedIssue?.id, text: "【形态学】补日志" });
    expect(editedIssue).not.toHaveProperty("title");
    expect((issuesZone().querySelector('[aria-label="问题分组 形态学"] textarea') as HTMLTextAreaElement | null)?.value).toBe(
      "【形态学】补日志",
    );
    expect((issuesZone().querySelector('[aria-label="问题分组 设备"] textarea') as HTMLTextAreaElement | null)?.value).toBe(
      "【设备】账号锁定",
    );
    expect(current.projects).toBe(projects);
    expect(titleEditorHits(issuesZone())).toEqual([]);

    await act(async () => {
      setControl(
        plansZone().querySelectorAll("textarea")[1] as HTMLTextAreaElement,
        "【采购】下周对账",
      );
    });
    expect(current.nextWeek.find((row) => row.id === addedPlan?.id)).toMatchObject({
      projectName: "采购",
      items: ["【采购】下周对账"],
    });
    expect(current.nextWeek.find((row) => row.id === addedPlan?.id)).not.toHaveProperty("title");
    expect(current.nextWeek.find((row) => row.id === "n-old")?.projectName).toBe("已有计划");
    expect(plansZone().querySelector('[aria-label="下周分组 采购"]')).not.toBeNull();
    expect(current.projects).toBe(projects);

    await act(async () => {
      setControl(plansZone().querySelector('[aria-label="下周分组 采购"] textarea') as HTMLTextAreaElement, "没有括号");
    });
    expect(current.nextWeek.find((row) => row.id === addedPlan?.id)?.projectName).toBe("未分类");
    expect(current.nextWeek.find((row) => row.id === addedPlan?.id)?.items).toEqual(["没有括号"]);
    expect(plansZone().querySelector('[aria-label="下周分组 未分类"]')).not.toBeNull();
    expect(current.projects).toEqual(initial.projects);
    expect(titleEditorHits(issuesZone())).toEqual([]);
    expect(titleEditorHits(plansZone())).toEqual([]);

    await act(async () => {
      buttons("从重要事项带入项目名", plansZone())[0].click();
    });
    const carried = current.nextWeek.find((row) => row.projectName === "设备管理");
    expect(carried).toMatchObject({ projectName: "设备管理", items: [""] });
    expect(carried).not.toHaveProperty("title");
    expect(current.projects).toBe(projects);
    expect(titleEditorHits(plansZone())).toEqual([]);
    expect(plansZone().querySelector('input[placeholder="标题"]')).toBeNull();
    expect(plansZone().querySelector('input[placeholder="项目"]')).not.toBeNull();
    expect(plansZone().querySelector('textarea[placeholder="工作内容（每行一条）"]')).not.toBeNull();
    expect(issuesZone().querySelector('textarea[placeholder="问题或建议"]')).not.toBeNull();
  });

  it("empty zones gain rows without a 标题 field and still group by 【】", async () => {
    await mount({
      projects: [],
      issues: { empty: false, items: [] },
      nextWeek: [],
    });
    expect(issuesZone().textContent).toContain("暂无问题或建议");
    expect(plansZone().textContent).toContain("暂无下周计划");
    expect(titleEditorHits(issuesZone())).toEqual([]);
    expect(titleEditorHits(plansZone())).toEqual([]);

    await act(async () => {
      buttons("添加一条", issuesZone())[0].click();
    });
    await act(async () => {
      buttons("添加一行", plansZone())[0].click();
    });
    expect(issuesZone().textContent).not.toContain("暂无问题或建议");
    expect(plansZone().textContent).not.toContain("暂无下周计划");
    expect(titleEditorHits(issuesZone())).toEqual([]);
    expect(titleEditorHits(plansZone())).toEqual([]);
    expect(current.issues.items).toEqual([{ id: expect.any(String), text: "" }]);
    expect(current.issues.items[0]).not.toHaveProperty("title");
    expect(current.nextWeek).toEqual([{ id: expect.any(String), projectName: "", items: [""] }]);
    expect(current.nextWeek[0]).not.toHaveProperty("title");
    expect(current.projects).toEqual([]);

    await act(async () => {
      setControl(issuesZone().querySelector("textarea") as HTMLTextAreaElement, "【设备】需要手册");
    });
    await act(async () => {
      setControl(plansZone().querySelector("textarea") as HTMLTextAreaElement, "直接写计划");
    });
    expect(current.issues.items[0]).toEqual({ id: expect.any(String), text: "【设备】需要手册" });
    expect(current.issues.items[0]).not.toHaveProperty("title");
    expect(issuesZone().querySelector('[aria-label="问题分组 设备"]')).not.toBeNull();
    expect(issuesZone().querySelector('[aria-label="问题分组 未分类"]')).toBeNull();
    expect(current.nextWeek[0]?.projectName).toBe("未分类");
    expect(current.nextWeek[0]?.items).toEqual(["直接写计划"]);
    expect(plansZone().querySelector('[aria-label="下周分组 未分类"]')).not.toBeNull();
    expect(current.projects).toEqual([]);
    expect(titleEditorHits(issuesZone())).toEqual([]);
    expect(titleEditorHits(plansZone())).toEqual([]);
  });

  it("N/A issues hide the list and still have no 标题 field", async () => {
    await mount({
      projects: [{ id: "p1", name: "设备管理", bullets: ["联调"] }],
      issues: { empty: true, items: [{ id: "i1", title: "隐藏标题", text: "【设备】不会画出来" }] },
      nextWeek: [],
    });
    expect(issuesZone().textContent).not.toContain("隐藏标题");
    expect(issuesZone().textContent).not.toContain("不会画出来");
    expect(plansZone().textContent).toContain("暂无下周计划");
    expect(titleEditorHits(issuesZone())).toEqual([]);
    expect(titleEditorHits(plansZone())).toEqual([]);

    const projects = current.projects;
    const checkbox = issuesZone().querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    expect(current.issues.empty).toBe(false);
    expect(current.issues.items[0]?.title).toBe("隐藏标题");
    expect((issuesZone().querySelector("textarea") as HTMLTextAreaElement | null)?.value).toBe("【设备】不会画出来");
    expect(issuesZone().querySelector('[aria-label="问题分组 设备"]')).not.toBeNull();
    expect(issuesZone().textContent).not.toContain("隐藏标题");
    expect(titleEditorHits(issuesZone())).toEqual([]);
    expect(current.projects).toBe(projects);
  });

  it("source for both zones has no 标题 editor markup", () => {
    const panel = readRepo("src/components/ZoneMergePanel.tsx");
    const issuesSource = sliceBetween(panel, 'id="merge-zone-issues"', 'id="merge-zone-nextWeek"');
    const plansSource = sliceBetween(panel, 'id="merge-zone-nextWeek"', "function ProjectBulletsEditor");
    const preview = readRepo("src/pages/PreviewPage.tsx");
    const materials = readRepo("src/pages/MaterialsPage.tsx");
    const surfaces: { name: string; source: string }[] = [
      { name: "ZoneMergePanel issues", source: issuesSource },
      { name: "ZoneMergePanel nextWeek", source: plansSource },
      { name: "ZoneMergePanel.tsx", source: panel },
      { name: "MaterialsPage.tsx", source: materials },
      { name: "PreviewPage IssuesEditor", source: sliceBetween(preview, "function IssuesEditor", "function PlanEditor") },
      { name: "PreviewPage PlanEditor", source: sliceBetween(preview, "function PlanEditor") },
      { name: "YunxiaoImportModal.tsx", source: readRepo("src/components/YunxiaoImportModal.tsx") },
      { name: "IngestUploadModal.tsx", source: readRepo("src/components/IngestUploadModal.tsx") },
      { name: "AiSummarizeControl.tsx", source: readRepo("src/components/AiSummarizeControl.tsx") },
      { name: "index.css", source: readRepo("src/index.css") },
    ];
    const found = surfaces.flatMap((surface) =>
      fieldHits(surface.source).map((hit) => `${surface.name}: ${hit}`),
    );
    expect(found).toEqual([]);
    expect(readRepo("src/index.css")).not.toMatch(/content\s*:\s*["'][^"']*标题/);
    expect(issuesSource).not.toMatch(/item\.title/);
    expect(plansSource).not.toMatch(/\.title/);
    expect(panel).toContain('placeholder="问题或建议"');
    expect(panel).toContain('placeholder="项目"');
    expect(panel).toContain('placeholder="工作内容（每行一条）"');
    expect(panel).toContain("暂无问题或建议。");
    expect(panel).toContain("暂无下周计划。");
  });
});
