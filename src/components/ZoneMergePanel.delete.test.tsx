/**
 * @vitest-environment happy-dom
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import type { ZoneSnapshot } from "../lib/zoneMerge";
import { itemDeleteConfirmCopy, ZoneMergePanel } from "./ZoneMergePanel";

function Host({ initial }: { initial: ZoneSnapshot }) {
  const [value, setValue] = useState(initial);
  return <ZoneMergePanel value={value} onChange={setValue} />;
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

const sample = (): ZoneSnapshot => ({
  projects: [
    { id: "p1", name: "设备管理", bullets: ["联调", "上线"], status: "in_progress" },
    { id: "p2", name: "ERP", bullets: ["对账"] },
  ],
  issues: { empty: false, items: [{ id: "i1", text: "登录失败" }] },
  nextWeek: [{ id: "n1", projectName: "设备管理", items: ["压测"] }],
});

async function mount(initial: ZoneSnapshot) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<Host initial={initial} />);
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

function buttons(text: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll("button")].filter((node) => node.textContent?.trim() === text) as HTMLButtonElement[];
}

async function clickButton(text: string, scope: ParentNode = document) {
  const button = buttons(text, scope)[0];
  if (!button) throw new Error(`no button ${text}`);
  await act(async () => {
    button.click();
  });
}

function projectCard(name: string) {
  const card = [...document.querySelectorAll("article.project-card")].find((node) => {
    if (node.querySelector(".project-collapse-name")?.textContent === name) return true;
    const input = node.querySelector('input[placeholder="项目名称 *"]') as HTMLInputElement | null;
    return input?.value === name;
  });
  if (!card) throw new Error(`no project card ${name}`);
  return card;
}

function primaryDeleteLabels() {
  return [...document.querySelectorAll("button")]
    .filter((button) => {
      const text = button.textContent?.trim();
      if (text !== "删除" && text !== "删除项目" && text !== "删除要点") return false;
      return !button.closest(".row-menu");
    })
    .map((button) => button.textContent?.trim());
}

describe("project delete undo", () => {
  it("hides delete behind ⋯ until confirm, then restores the whole tree from the merge bar", async () => {
    await mount(sample());

    expect(primaryDeleteLabels()).toEqual([]);
    expect(buttons("撤销本次合并")[0].disabled).toBe(true);
    expect(document.querySelector('summary[aria-label="更多 设备管理"]')).not.toBeNull();
    const head = projectCard("设备管理").querySelector(".project-head")!;
    expect([...head.querySelectorAll(":scope > button")].map((button) => button.textContent?.trim())).toEqual([
      "上移",
      "下移",
      "展开",
      "一键总结",
    ]);
    expect(head.querySelector(":scope > .btn-danger")).toBeNull();

    await clickButton("删除项目", projectCard("设备管理"));
    expect(document.body.textContent).toContain("删除该项目会同时删除其下全部要点条目");
    expect(document.body.textContent).toContain("可使用上方「撤销本次合并」恢复整个项目及其全部条目");
    await clickButton("取消");
    expect(projectCard("设备管理")).toBeTruthy();
    expect(buttons("撤销本次合并")[0].disabled).toBe(true);

    const device = document.querySelector('input[aria-label="选择重要事项 设备管理"]') as HTMLInputElement;
    const erp = document.querySelector('input[aria-label="选择重要事项 ERP"]') as HTMLInputElement;
    await act(async () => {
      device.click();
    });
    await act(async () => {
      erp.click();
    });
    expect(buttons("合并")[0].disabled).toBe(false);
    await act(async () => {
      (document.querySelector('button[aria-label="展开 设备管理"]') as HTMLButtonElement).click();
    });
    const bullets = projectCard("设备管理").querySelector("textarea.project-bullets-input") as HTMLTextAreaElement;
    expect(bullets.value).toBe("联调\n上线");
    expect(projectCard("设备管理").querySelector(".bullet-move-row")).toBeNull();
    expect(projectCard("设备管理").textContent).not.toContain("移到其他项目");
    expect(projectCard("设备管理").querySelector(".bullet-row")).toBeNull();
    expect(projectCard("设备管理").textContent).not.toContain("删除要点");

    await clickButton("删除项目", projectCard("设备管理"));
    await clickButton("确定删除");

    expect(document.querySelector('input[aria-label="选择重要事项 设备管理"]')).toBeNull();
    expect(document.body.textContent).not.toContain("联调");
    expect(document.body.textContent).toContain("ERP");
    expect(buttons("合并")[0].disabled).toBe(true);
    expect((document.querySelector('input[aria-label="选择重要事项 ERP"]') as HTMLInputElement).checked).toBe(true);
    expect(buttons("撤销本次合并")[0].disabled).toBe(false);
    expect(primaryDeleteLabels()).toEqual([]);

    await clickButton("撤销本次合并");
    expect(document.querySelector('button[aria-label="展开 设备管理"]')?.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent).not.toContain("联调");
    expect((document.querySelector('input[aria-label="选择重要事项 设备管理"]') as HTMLInputElement).checked).toBe(false);
    await act(async () => {
      (document.querySelector('button[aria-label="展开 设备管理"]') as HTMLButtonElement).click();
    });
    expect((projectCard("设备管理").querySelector("textarea.project-bullets-input") as HTMLTextAreaElement).value).toBe(
      "联调\n上线",
    );
    expect(buttons("撤销本次合并")[0].disabled).toBe(true);
  });

  it("deletes down to an empty project zone and undoes merge then delete in LIFO order", async () => {
    await mount(sample());
    const device = document.querySelector('input[aria-label="选择重要事项 设备管理"]') as HTMLInputElement;
    const erp = document.querySelector('input[aria-label="选择重要事项 ERP"]') as HTMLInputElement;
    await act(async () => {
      device.click();
    });
    await act(async () => {
      erp.click();
    });
    await clickButton("合并");
    expect(document.querySelectorAll("article.project-card")).toHaveLength(1);
    expect(document.body.textContent).toContain("设备管理");
    expect(document.body.textContent).not.toContain("ERP");

    await clickButton("删除项目");
    await clickButton("确定删除");
    expect(document.querySelectorAll("article.project-card")).toHaveLength(0);
    expect(document.body.textContent).toContain("添加项目");
    expect(document.body.textContent).toContain("暂无重要事项");
    expect(document.querySelector('input[placeholder="项目名称 *"]')).toBeNull();
    expect(document.body.textContent).not.toContain("未命名项目");
    expect(document.body.textContent).toContain("登录失败");

    await clickButton("撤销本次合并");
    expect(document.querySelectorAll("article.project-card")).toHaveLength(1);
    await act(async () => {
      (document.querySelector('button[aria-label="展开 设备管理"]') as HTMLButtonElement).click();
    });
    expect((projectCard("设备管理").querySelector("textarea.project-bullets-input") as HTMLTextAreaElement).value).toContain(
      "联调",
    );
    expect((projectCard("设备管理").querySelector("textarea.project-bullets-input") as HTMLTextAreaElement).value).toContain(
      "上线",
    );
    expect((projectCard("设备管理").querySelector("textarea.project-bullets-input") as HTMLTextAreaElement).value).toContain(
      "对账",
    );

    await clickButton("撤销本次合并");
    expect(document.querySelector('button[aria-label="展开 设备管理"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="展开 ERP"]')).not.toBeNull();
    expect(document.querySelectorAll("article.project-card")).toHaveLength(2);
    await act(async () => {
      (document.querySelector('button[aria-label="展开 ERP"]') as HTMLButtonElement).click();
    });
    const bulletValues = [...document.querySelectorAll("textarea")].map((node) => (node as HTMLTextAreaElement).value);
    expect(bulletValues).toContain("对账");
    expect(bulletValues).not.toContain("上线");
    expect(bulletValues).not.toContain("联调");
  });

  it("confirms one child entry from the menu and leaves merge undo disabled", async () => {
    await mount(sample());
    await act(async () => {
      (document.querySelector('button[aria-label="展开 设备管理"]') as HTMLButtonElement).click();
    });
    const bullets = projectCard("设备管理").querySelector("textarea.project-bullets-input") as HTMLTextAreaElement;
    expect(bullets.value).toBe("联调\n上线");
    expect(projectCard("设备管理").querySelector(".bullet-row")).toBeNull();
    expect(projectCard("设备管理").textContent).not.toContain("删除要点");
    expect(buttons("撤销本次合并")[0].disabled).toBe(true);
    expect(document.querySelectorAll("article.project-card")).toHaveLength(2);

    const issue = document.querySelector('textarea[aria-label="问题内容 1"]')!.closest("article")!;
    await clickButton("删除", issue);
    expect(document.querySelector('[aria-label="确认删除问题"]')?.textContent).toContain("不会删除整个项目");
    expect(issue.textContent).toContain("登录失败");
    await clickButton("取消");
    expect(issue.textContent).toContain("登录失败");
    await clickButton("删除", issue);
    await clickButton("确定删除");
    expect(document.body.textContent).not.toContain("登录失败");

    const plan = document.querySelector('input[placeholder="项目"]')!.closest("article")!;
    await clickButton("删除", plan);
    expect(document.querySelector('[aria-label="确认删除下周计划"]')?.textContent).toContain("仅删除这一行");
    expect(document.querySelector('[aria-label="确认删除下周计划"]')?.textContent).toContain("不会删除整个项目");
    expect((document.querySelector('textarea[placeholder="工作内容（每行一条）"]') as HTMLTextAreaElement).value).toBe("压测");
    await clickButton("取消");
    expect(document.querySelector('input[placeholder="项目"]')).not.toBeNull();
    await clickButton("删除", plan);
    await clickButton("确定删除");
    expect(document.querySelector('input[placeholder="项目"]')).toBeNull();
    expect(document.body.textContent).not.toContain("压测");
    expect(buttons("撤销本次合并")[0].disabled).toBe(true);
    expect(document.querySelectorAll("article.project-card")).toHaveLength(2);
  });
});

describe("item delete confirm copy", () => {
  it("names the single row and says the project stays", () => {
    expect(itemDeleteConfirmCopy("bullet", " 联调 ")).toBe("确定删除要点「联调」？仅删除这一条要点，不会删除整个项目。");
    expect(itemDeleteConfirmCopy("issue", "登录失败")).toBe(
      "确定删除问题或建议「登录失败」？仅删除这一条，不会删除整个项目。",
    );
    expect(itemDeleteConfirmCopy("nextWeek", "设备管理")).toBe(
      "确定删除下周计划「设备管理」？仅删除这一行，不会删除整个项目。",
    );
    expect(itemDeleteConfirmCopy("bullet", "")).toBe("确定删除要点？仅删除这一条要点，不会删除整个项目。");
    expect(itemDeleteConfirmCopy("bullet", "联调")).not.toContain("全部要点");
    expect(itemDeleteConfirmCopy("bullet", "联调")).not.toContain("撤销本次合并");
  });
});
