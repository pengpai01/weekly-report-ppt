/**
 * @vitest-environment happy-dom
 *
 * 重要事项 folded-row rename writes only projects[i].name.
 * 问题区 / 下周 【】 stay independent. Merge and 带入 follow the new name.
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import type { ZoneSnapshot } from "../lib/zoneMerge";
import { ZoneMergePanel } from "./ZoneMergePanel";

function snapshot(): ZoneSnapshot {
  return {
    projects: [
      { id: "p1", name: "设备管理", bullets: ["联调"], status: "in_progress" },
      { id: "p2", name: "ERP", bullets: ["对账"] },
    ],
    issues: { empty: false, items: [{ id: "i1", text: "【设备】账号锁定" }] },
    nextWeek: [{ id: "n1", projectName: "形态学", items: ["【形态学】压测"] }],
  };
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let current: ZoneSnapshot = snapshot();

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

async function mount(initial: ZoneSnapshot = snapshot()) {
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

function buttons(text: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll("button")].filter((node) => node.textContent?.trim() === text) as HTMLButtonElement[];
}

function setControl(field: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

async function commitName(field: HTMLInputElement, value: string) {
  await act(async () => {
    setControl(field, value);
    field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

function projectNameInput(label: string): HTMLInputElement {
  const field = document.querySelector(
    `#merge-zone-projects input[aria-label="${label}"]`,
  ) as HTMLInputElement | null;
  if (!field) throw new Error(`missing ${label}`);
  return field;
}

describe("重要事项 folded project name", () => {
  it("edits the collapsed header, commits 未分类, and leaves partitions alone", async () => {
    await mount();
    const issues = current.issues;
    const nextWeek = current.nextWeek;
    const other = current.projects[1];
    const card = document.querySelector("#merge-zone-projects article.project-card.is-collapsed") as HTMLElement;
    const name = projectNameInput("项目名称 设备管理");
    expect(card.querySelector("input.project-name-input")).toBe(name);
    expect(name.placeholder).toBe("项目名称 *");
    expect(name.value).toBe("设备管理");
    expect(card.querySelector(".project-collapse-count")?.textContent).toBe("1 条");
    expect(document.querySelector("#merge-zone-projects textarea")).toBeNull();

    await act(async () => {
      setControl(name, "【试点】仪器");
    });
    expect(current.projects[0]).toMatchObject({
      id: "p1",
      name: "【试点】仪器",
      bullets: ["联调"],
      status: "in_progress",
    });
    expect(current.projects[1]).toBe(other);
    expect(current.issues).toBe(issues);
    expect(current.nextWeek).toBe(nextWeek);
    expect(current.issues.items[0].text).toBe("【设备】账号锁定");
    expect(current.nextWeek[0]).toMatchObject({ projectName: "形态学", items: ["【形态学】压测"] });
    expect(document.querySelector('button[aria-label="一键总结 【试点】仪器"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="展开 【试点】仪器"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="问题分组 设备"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="下周分组 形态学"]')).not.toBeNull();

    const renamed = projectNameInput("项目名称 【试点】仪器");
    await act(async () => {
      setControl(renamed, "");
      renamed.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(current.projects[0].name).toBe("【试点】仪器");
    expect(projectNameInput("项目名称 【试点】仪器").value).toBe("【试点】仪器");
    expect(current.issues).toBe(issues);
    expect(current.nextWeek).toBe(nextWeek);

    await commitName(projectNameInput("项目名称 【试点】仪器"), "   ");
    expect(current.projects[0].name).toBe("未分类");
    expect(projectNameInput("项目名称 未分类").value).toBe("未分类");
    expect(current.projects[1]).toBe(other);
    expect(current.issues).toBe(issues);
    expect(current.nextWeek).toBe(nextWeek);
    expect(current.issues.items[0].text).toBe("【设备】账号锁定");

    const erp = [...document.querySelectorAll("#merge-zone-projects input.project-name-input")][1] as HTMLInputElement;
    await commitName(erp, "未分类");
    expect(current.projects.map((project) => project.name)).toEqual(["未分类", "未分类"]);
    expect(document.querySelectorAll("#merge-zone-projects article.project-card")).toHaveLength(2);
    expect(current.issues).toBe(issues);
    expect(current.nextWeek).toBe(nextWeek);
  });

  it("shows 未分类 for an empty draft name without writing until the field is cleared", async () => {
    await mount({
      projects: [{ id: "p1", name: "", bullets: ["待填"] }],
      issues: { empty: true, items: [] },
      nextWeek: [],
    });
    const name = projectNameInput("项目名称 未分类");
    expect(name.value).toBe("未分类");
    expect(current.projects[0].name).toBe("");
    expect(document.querySelector('button[aria-label="展开 未分类"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="一键总结 未分类"]')).not.toBeNull();

    await act(async () => {
      name.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(current.projects[0].name).toBe("");

    await commitName(name, "");
    expect(current.projects[0].name).toBe("未分类");
    expect(current.projects[0].bullets).toEqual(["待填"]);
    expect(current.issues.items).toEqual([]);
    expect(current.nextWeek).toEqual([]);
  });

  it("merge and 从重要事项带入项目名 follow the renamed project", async () => {
    await mount();
    const issues = current.issues;
    const originalPlan = current.nextWeek[0];

    await commitName(projectNameInput("项目名称 ERP"), "企业资源计划系统");
    expect(current.projects.map((project) => project.name)).toEqual(["设备管理", "企业资源计划系统"]);
    expect(current.issues).toBe(issues);
    expect(current.nextWeek[0]).toBe(originalPlan);

    await commitName(projectNameInput("项目名称 企业资源计划系统"), "形态学");
    expect(current.projects.map((project) => project.name)).toEqual(["设备管理", "形态学"]);
    expect(current.nextWeek).toEqual([originalPlan]);
    expect(current.nextWeek[0]).toBe(originalPlan);
    expect(current.issues.items[0].text).toBe("【设备】账号锁定");

    await commitName(projectNameInput("项目名称 形态学"), "企业资源计划系统");
    await act(async () => {
      buttons("从重要事项带入项目名")[0].click();
    });
    expect(current.nextWeek.map((row) => ({ projectName: row.projectName, items: row.items }))).toEqual([
      { projectName: "形态学", items: ["【形态学】压测"] },
      { projectName: "设备管理", items: [""] },
      { projectName: "企业资源计划系统", items: [""] },
    ]);
    expect(current.nextWeek[0]).toBe(originalPlan);
    expect(current.issues.items[0].text).toBe("【设备】账号锁定");

    await act(async () => {
      (document.querySelector('input[aria-label="选择重要事项 设备管理"]') as HTMLInputElement).click();
    });
    await act(async () => {
      (document.querySelector('input[aria-label="选择重要事项 企业资源计划系统"]') as HTMLInputElement).click();
    });
    await act(async () => {
      buttons("合并")[0].click();
    });
    expect(current.projects).toHaveLength(1);
    expect(current.projects[0].name).toBe("企业资源计划系统");
    expect(current.projects[0].bullets).toEqual(["联调", "对账"]);
    expect(current.issues).toBe(issues);
    expect(current.nextWeek[0]).toBe(originalPlan);
    expect(current.issues.items[0].text).toBe("【设备】账号锁定");
    expect(document.body.textContent).not.toContain("移到其他项目");
  });
});
