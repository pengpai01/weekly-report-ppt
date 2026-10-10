/**
 * @vitest-environment happy-dom
 *
 * Guard: an expanded 重要事项 project shows one bullets textarea and the
 * project-level 一键总结 button. The old plain-text list under that box
 * (bullet-move-row / 移到其他项目) must not come back.
 * Tip b6fdf6f already renders only ProjectBulletsEditor when the card is open.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/** Markup from the removed per-bullet list that used to sit under the textarea. */
const DEAD_LIST_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "bullet-move-row", re: /bullet-move-row/ },
  { name: "bullet-move-item", re: /bullet-move-item/ },
  { name: "bullet-move-text", re: /bullet-move-text/ },
  { name: "bullet-move-target", re: /bullet-move-target/ },
  { name: "移到其他项目", re: /移到其他项目/ },
  { name: "（空要点）", re: /（空要点）/ },
];

const DEAD_LIST_SELECTOR = ".bullet-move-row, .bullet-move-item, .bullet-move-text, .bullet-move-target";

function deadListHits(source: string): string[] {
  return DEAD_LIST_PATTERNS.filter((pattern) => pattern.re.test(source)).map((pattern) => pattern.name);
}

function plainTextOutsideFields(root: ParentNode): string[] {
  const texts: string[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (el.matches("textarea, input, select, option, script, style")) return;
      for (const child of el.childNodes) visit(child);
      return;
    }
    if (node.nodeType !== Node.TEXT_NODE) return;
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) texts.push(text);
  };
  for (const child of root.childNodes) visit(child);
  return texts;
}

/** Bullet strings repeated as text or attributes outside the single textarea. */
function bulletEchoHits(card: ParentNode, bullets: string[]): string[] {
  const needles = bullets.map((line) => line.trim()).filter(Boolean);
  const hits: string[] = [];
  for (const text of plainTextOutsideFields(card)) {
    for (const needle of needles) {
      if (text.includes(needle)) hits.push(`text "${text}"`);
    }
  }
  for (const el of card.querySelectorAll("*")) {
    if (el.matches("textarea.project-bullets-input")) continue;
    for (const attr of [...el.attributes]) {
      for (const needle of needles) {
        if (attr.value.includes(needle)) hits.push(`${el.tagName.toLowerCase()} ${attr.name}="${attr.value}"`);
      }
    }
  }
  return hits;
}

function buttons(text: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll("button")].filter((node) => node.textContent?.trim() === text) as HTMLButtonElement[];
}

function setControl(field: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
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

function projectsZone(): HTMLElement {
  const node = document.getElementById("merge-zone-projects");
  if (!node) throw new Error("missing projects zone");
  return node;
}

function projectCard(name: string): HTMLElement {
  const card = [...projectsZone().querySelectorAll("article.project-card")].find((node) => {
    if (node.querySelector(".project-collapse-name")?.textContent === name) return true;
    const input = node.querySelector('input[placeholder="项目名称 *"]') as HTMLInputElement | null;
    return input?.value === name;
  });
  if (!card) throw new Error(`no project card ${name}`);
  return card as HTMLElement;
}

function bulletsField(card: ParentNode): HTMLTextAreaElement {
  const fields = [...card.querySelectorAll("textarea.project-bullets-input")] as HTMLTextAreaElement[];
  expect(fields).toHaveLength(1);
  return fields[0];
}

const sample = (): ZoneSnapshot => ({
  projects: [
    { id: "p1", name: "设备管理", bullets: ["协议联调要点甲", "验收上线要点乙"], status: "in_progress" },
    { id: "p2", name: "ERP", bullets: ["对账要点丙"] },
  ],
  issues: { empty: false, items: [{ id: "i1", text: "【设备】登录失败" }] },
  nextWeek: [{ id: "n1", projectName: "设备管理", items: ["压测"] }],
});

function expectSingleBulletsEditor(name: string, bullets: string[]) {
  const card = projectCard(name);
  const field = bulletsField(card);
  expect(field.value).toBe(bullets.join("\n"));
  expect(field.nextElementSibling).toBeNull();
  expect(card.querySelector(DEAD_LIST_SELECTOR)).toBeNull();
  expect(card.querySelector("ul, ol, pre")).toBeNull();
  expect(card.textContent).not.toContain("移到其他项目");
  expect(card.textContent).not.toContain("（空要点）");
  expect(bulletEchoHits(card, bullets)).toEqual([]);
  expect(card.querySelector(`button[aria-label="一键总结 ${name}"]`)?.textContent).toBe("一键总结");
  expect(buttons("一键总结", card)).toHaveLength(1);
  return field;
}

describe("project bullets stay a single textarea", () => {
  it("collapsed cards hide bullet text and still offer 一键总结", async () => {
    await mount(sample());
    expect(projectsZone().querySelectorAll("textarea.project-bullets-input")).toHaveLength(0);
    expect(document.querySelector(DEAD_LIST_SELECTOR)).toBeNull();
    expect(document.body.textContent).not.toContain("移到其他项目");
    expect(document.body.textContent).not.toContain("协议联调要点甲");
    expect(document.body.textContent).not.toContain("验收上线要点乙");
    expect(document.body.textContent).not.toContain("对账要点丙");
    expect(projectCard("设备管理").querySelector(".project-collapse-count")?.textContent).toBe("2 条");
    expect(projectCard("设备管理").querySelector('button[aria-label="一键总结 设备管理"]')?.textContent).toBe("一键总结");
    expect(projectCard("ERP").querySelector('button[aria-label="一键总结 ERP"]')?.textContent).toBe("一键总结");
  });

  it("an expanded project has one textarea and no plain-text copy of the same bullets", async () => {
    await mount(sample());
    await act(async () => {
      (document.querySelector('button[aria-label="展开 设备管理"]') as HTMLButtonElement).click();
    });

    expect(projectsZone().querySelectorAll("textarea.project-bullets-input")).toHaveLength(1);
    const field = expectSingleBulletsEditor("设备管理", ["协议联调要点甲", "验收上线要点乙"]);
    expect(projectCard("ERP").querySelector("textarea.project-bullets-input")).toBeNull();
    expect(bulletEchoHits(projectCard("ERP"), ["对账要点丙"])).toEqual([]);
    expect(document.body.textContent).not.toContain("对账要点丙");
    expect(document.body.textContent).not.toContain("移到其他项目");

    await act(async () => {
      setControl(field, "协议联调要点甲\n新要点丁\n验收上线要点乙");
    });
    expect(current.projects[0].bullets).toEqual(["协议联调要点甲", "新要点丁", "验收上线要点乙"]);
    expect(projectsZone().querySelectorAll("textarea.project-bullets-input")).toHaveLength(1);
    expectSingleBulletsEditor("设备管理", ["协议联调要点甲", "新要点丁", "验收上线要点乙"]);
    expect(current.projects[1].bullets).toEqual(["对账要点丙"]);
    expect(current.issues.items[0].text).toBe("【设备】登录失败");
  });

  it("each expanded project keeps its own single textarea", async () => {
    await mount(sample());
    await act(async () => {
      (document.querySelector('button[aria-label="展开 设备管理"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (document.querySelector('button[aria-label="展开 ERP"]') as HTMLButtonElement).click();
    });
    expect(projectsZone().querySelectorAll("textarea.project-bullets-input")).toHaveLength(2);
    expectSingleBulletsEditor("设备管理", ["协议联调要点甲", "验收上线要点乙"]);
    expectSingleBulletsEditor("ERP", ["对账要点丙"]);
    expect(document.querySelector(DEAD_LIST_SELECTOR)).toBeNull();
    expect(document.body.textContent).not.toContain("移到其他项目");
  });

  it("an empty bullet list is one empty textarea, not a placeholder row", async () => {
    await mount({
      projects: [{ id: "p1", name: "设备管理", bullets: [] }],
      issues: { empty: true, items: [] },
      nextWeek: [],
    });
    await act(async () => {
      (document.querySelector('button[aria-label="展开 设备管理"]') as HTMLButtonElement).click();
    });
    const field = expectSingleBulletsEditor("设备管理", []);
    expect(field.value).toBe("");
    expect(projectCard("设备管理").textContent).not.toContain("（空要点）");
    expect(document.body.textContent).not.toContain("移到其他项目");
  });

  it("source has no second bullet list under the project editor", () => {
    const panel = readRepo("src/components/ZoneMergePanel.tsx");
    const projectsSource = sliceBetween(panel, 'id="merge-zone-projects"', 'id="merge-zone-issues"');
    const editorSource = sliceBetween(panel, "function ProjectBulletsEditor", "function partitionAnchorIndex");
    const preview = readRepo("src/pages/PreviewPage.tsx");
    const projectEditor = sliceBetween(preview, "function ProjectEditor", "function IssuesEditor");
    const materials = readRepo("src/pages/MaterialsPage.tsx");
    const yunxiao = readRepo("src/components/YunxiaoImportModal.tsx");
    const ingest = readRepo("src/components/IngestUploadModal.tsx");
    const css = readRepo("src/index.css");
    const surfaces: { name: string; source: string }[] = [
      { name: "ZoneMergePanel projects", source: projectsSource },
      { name: "ProjectBulletsEditor", source: editorSource },
      { name: "ZoneMergePanel.tsx", source: panel },
      { name: "MaterialsPage.tsx", source: materials },
      { name: "PreviewPage ProjectEditor", source: projectEditor },
      { name: "YunxiaoImportModal.tsx", source: yunxiao },
      { name: "IngestUploadModal.tsx", source: ingest },
      { name: "AiSummarizeControl.tsx", source: readRepo("src/components/AiSummarizeControl.tsx") },
      { name: "index.css", source: css },
    ];
    const found = surfaces.flatMap((surface) => deadListHits(surface.source).map((hit) => `${surface.name}: ${hit}`));
    expect(found).toEqual([]);

    expect(occurrences(projectsSource, "<ProjectBulletsEditor")).toBe(1);
    expect(occurrences(projectsSource, "<ProjectAiButton")).toBe(1);
    expect(projectsSource).not.toMatch(/project\.bullets\.map\s*\(/);
    expect(projectsSource).not.toMatch(/bullets\.map\s*\(/);
    expect(editorSource.match(/<textarea/g)).toHaveLength(1);
    expect(editorSource).toContain("project-bullets-input");
    expect(editorSource).not.toMatch(/\.map\s*\(/);
    expect(editorSource).not.toMatch(/<ul|<ol|<pre|<li/);
    expect(css).toMatch(/\.project-bullets-input\b/);
    expect(css).not.toMatch(/\.bullet-move-/);
    expect(projectEditor).not.toMatch(/>\s*\{b\}\s*</);
    expect(occurrences(materials, "<ZoneMergePanel")).toBe(1);
    expect(occurrences(yunxiao, "<ZoneMergePanel")).toBe(1);
    expect(occurrences(ingest, "<ZoneMergePanel")).toBe(1);
    expect(panel).toContain('placeholder="进展要点（每行一条）"');
  });
});
