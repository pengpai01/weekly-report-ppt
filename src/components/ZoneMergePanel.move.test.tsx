/**
 * @vitest-environment happy-dom
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import type { ZoneSnapshot } from "../lib/zoneMerge";
import { moveProjectBullet, moveTargetProjects, ZoneMergePanel } from "./ZoneMergePanel";

function snapshot(): ZoneSnapshot {
  return {
    projects: [
      {
        id: "p1",
        name: "设备管理",
        bullets: ["联调", "上线"],
        status: "in_progress",
        statusLabel: "进行中",
        owner: "张三",
        mergeLines: [{ text: "联调", sourceId: "s1" }],
      },
      { id: "p2", name: "ERP", bullets: ["对账"], statusLabel: "已完成", mergeLines: [{ text: "对账" }] },
      { id: "p3", name: "形态学", bullets: ["标注"] },
    ],
    issues: { empty: false, items: [{ id: "i1", title: "登录失败", text: "登录失败" }] },
    nextWeek: [
      { id: "n1", projectName: "设备管理", items: ["压测"] },
      { id: "n2", projectName: "下周专项", items: ["不在项目列表"] },
    ],
  };
}

describe("moveProjectBullet", () => {
  it("splices one bullet onto the target bullets list and leaves every other zone alone", () => {
    const value = snapshot();
    const next = moveProjectBullet(value, "p1", 0, "p3");
    expect(next).not.toBe(value);
    expect(next.projects).toHaveLength(3);
    expect(next.projects.map((item) => item.id)).toEqual(["p1", "p2", "p3"]);
    expect(next.projects[0].bullets).toEqual(["上线"]);
    expect(next.projects[0].status).toBe("in_progress");
    expect(next.projects[0].mergeLines).toBeUndefined();
    expect(next.projects[0].statusLabel).toBeUndefined();
    expect(next.projects[0].owner).toBeUndefined();
    expect(next.projects[2].bullets).toEqual(["标注", "联调"]);
    expect(next.projects[2].name).toBe("形态学");
    expect(next.projects[1]).toBe(value.projects[1]);
    expect(next.issues).toBe(value.issues);
    expect(next.nextWeek).toBe(value.nextWeek);
    expect(moveTargetProjects(value.projects, "p1").map((item) => item.id)).toEqual(["p2", "p3"]);
  });

  it("does not create a project when the target is missing or is the source", () => {
    const value = snapshot();
    expect(moveProjectBullet(value, "p1", 0, "missing")).toBe(value);
    expect(moveProjectBullet(value, "p1", 0, "p1")).toBe(value);
    expect(moveProjectBullet(value, "p1", 5, "p3")).toBe(value);
    expect(moveProjectBullet(value, "p1", 0, "i1")).toBe(value);
    expect(moveProjectBullet(value, "p1", 0, "n2")).toBe(value);
    expect(value.projects).toHaveLength(3);
  });
});

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function Host({ initial }: { initial: ZoneSnapshot }) {
  const [value, setValue] = useState(initial);
  return <ZoneMergePanel value={value} onChange={setValue} />;
}

async function mount(initial: ZoneSnapshot = snapshot()) {
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

async function expand(name: string) {
  const button = document.querySelector(`button[aria-label="展开 ${name}"]`) as HTMLButtonElement | null;
  if (!button) throw new Error(`no expand ${name}`);
  await act(async () => {
    button.click();
  });
}

function bulletsField(name: string) {
  const field = document.querySelector(`textarea[aria-label="进展要点 ${name}"]`) as HTMLTextAreaElement | null;
  if (!field) throw new Error(`no bullets field ${name}`);
  return field;
}

describe("move one bullet to another project", () => {
  it("moves from the bullet row menu, then clears that selection without folding projects", async () => {
    await mount();

    expect(document.body.textContent).not.toContain("移到其他项目");
    expect(document.querySelector('summary[aria-label="更多 设备管理"]')?.parentElement?.textContent).toContain("删除项目");

    await expand("设备管理");
    const device = projectCard("设备管理");
    expect(device.querySelector('summary[aria-label="更多 设备管理"]')?.parentElement?.textContent).not.toContain("移到其他项目");
    expect(device.querySelector(".bullet-row")).toBeNull();
    expect(device.querySelectorAll(".bullet-move-row")).toHaveLength(2);
    expect(bulletsField("设备管理").value).toBe("联调\n上线");
    expect(document.querySelector('summary[aria-label="更多 问题 1"]')?.parentElement?.textContent).not.toContain("移到其他项目");
    expect(document.querySelector('summary[aria-label="更多 下周计划 设备管理"]')?.parentElement?.textContent).not.toContain(
      "移到其他项目",
    );

    const deviceCheck = document.querySelector('input[aria-label="选择重要事项 设备管理"]') as HTMLInputElement;
    const erpCheck = document.querySelector('input[aria-label="选择重要事项 ERP"]') as HTMLInputElement;
    await act(async () => {
      deviceCheck.click();
    });
    await act(async () => {
      erpCheck.click();
    });
    expect(buttons("合并")[0].disabled).toBe(false);

    const firstRow = device.querySelectorAll(".bullet-move-item")[0] as HTMLElement;
    await clickButton("移到其他项目", firstRow);
    const dialog = document.querySelector('[aria-label="移到其他项目"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(firstRow.querySelector(".bullet-move-row")?.classList.contains("is-selected")).toBe(true);
    const labels = [...dialog.querySelectorAll("label")].map((node) => node.textContent?.trim());
    expect(labels).toEqual(["ERP", "形态学"]);
    expect(dialog.textContent).not.toContain("登录失败");
    expect(dialog.textContent).not.toContain("下周专项");
    expect(dialog.textContent).not.toContain("添加项目");
    expect(dialog.querySelector('input[type="text"]')).toBeNull();
    expect(buttons("确定移动", dialog)[0].disabled).toBe(true);
    expect(buttons("撤销本次合并")[0].disabled).toBe(true);

    await clickButton("取消", dialog);
    expect(document.querySelector('[aria-label="移到其他项目"]')).toBeNull();
    expect(document.querySelector(".bullet-move-row.is-selected")).toBeNull();
    expect(bulletsField("设备管理").value).toBe("联调\n上线");

    await clickButton("移到其他项目", firstRow);
    const openDialog = document.querySelector('[aria-label="移到其他项目"]') as HTMLElement;
    const target = [...openDialog.querySelectorAll('input[type="radio"]')].find(
      (node) => (node as HTMLInputElement).value === "p3",
    ) as HTMLInputElement;
    await act(async () => {
      target.click();
    });
    await clickButton("确定移动", openDialog);

    expect(document.querySelector('[aria-label="移到其他项目"]')).toBeNull();
    expect(document.querySelector(".bullet-move-row.is-selected")).toBeNull();
    expect(bulletsField("设备管理").value).toBe("上线");
    expect(projectCard("设备管理").querySelectorAll(".bullet-move-row")).toHaveLength(1);
    expect(projectCard("设备管理").textContent).not.toContain("联调");
    expect(document.querySelector('button[aria-label="收起 设备管理"]')?.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('button[aria-label="展开 形态学"]')?.getAttribute("aria-expanded")).toBe("false");
    expect(projectCard("形态学").querySelector(".project-collapse-count")?.textContent).toBe("2 条");
    expect(document.querySelectorAll("article.project-card")).toHaveLength(3);
    expect((document.querySelector('input[aria-label="选择重要事项 设备管理"]') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('input[aria-label="选择重要事项 ERP"]') as HTMLInputElement).checked).toBe(true);
    expect(buttons("合并")[0].disabled).toBe(false);
    expect(buttons("撤销本次合并")[0].disabled).toBe(true);
    expect(document.body.textContent).toContain("登录失败");
    const planNames = [...document.querySelectorAll('input[placeholder="项目"]')].map(
      (node) => (node as HTMLInputElement).value,
    );
    expect(planNames).toEqual(["设备管理", "下周专项"]);

    await expand("形态学");
    expect(bulletsField("形态学").value).toBe("标注\n联调");
    expect(document.querySelector('button[aria-label="收起 设备管理"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="收起 形态学"]')?.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('button[aria-label="展开 ERP"]')?.getAttribute("aria-expanded")).toBe("false");
  });

  it("offers no new project when this page has nowhere else to put the bullet", async () => {
    await mount({
      projects: [{ id: "p1", name: "设备管理", bullets: ["联调"] }],
      issues: { empty: false, items: [{ id: "i1", text: "登录失败" }] },
      nextWeek: [{ id: "n1", projectName: "设备管理", items: ["压测"] }],
    });
    await expand("设备管理");
    await clickButton("移到其他项目", projectCard("设备管理"));
    const dialog = document.querySelector('[aria-label="移到其他项目"]') as HTMLElement;
    expect(dialog.textContent).toContain("当前页面没有其他项目");
    expect(dialog.querySelector('input[type="radio"]')).toBeNull();
    expect(buttons("确定移动", dialog)[0].disabled).toBe(true);
    expect(buttons("添加项目", dialog)).toHaveLength(0);
    expect(document.querySelectorAll("article.project-card")).toHaveLength(1);
  });
});
