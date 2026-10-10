/**
 * @vitest-environment happy-dom
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
    issues: {
      empty: false,
      items: [
        { id: "i1", title: "【别的】登录失败", text: "【设备】账号锁定" },
        { id: "i2", title: "补充说明", text: "需要值班手册" },
      ],
    },
    nextWeek: [
      { id: "n1", projectName: "【形态学】下周", items: ["【形态学】压测"] },
      { id: "n2", projectName: "其他计划", items: ["回归"] },
    ],
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

async function mount() {
  current = snapshot();
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

async function expand(label: string) {
  const button = document.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
  if (!button) throw new Error(`missing ${label}`);
  await act(async () => {
    button.click();
  });
}

function setControl(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("issue and next-week tags", () => {
  it("partitions issues by 【】 and fills next-week 项目 without writing projects", async () => {
    await mount();
    const issues = document.getElementById("merge-zone-issues") as HTMLElement;
    const plans = document.getElementById("merge-zone-nextWeek") as HTMLElement;
    const issueDevice = issues.querySelector('[aria-label="问题分组 设备"]') as HTMLElement;
    const issuePlain = issues.querySelector('[aria-label="问题分组 未分类"]') as HTMLElement;
    expect((issueDevice.querySelector(".issue-partition-name") as HTMLInputElement).value).toBe("设备");
    expect((issueDevice.querySelector(".issue-partition-name") as HTMLInputElement).placeholder).toBe("项目名称 *");
    expect(issueDevice.querySelector(".issue-partition-count")?.textContent).toBe("1 条");
    expect(issueDevice.querySelector(".zone-item-tag")).toBeNull();
    expect(issueDevice.querySelector("textarea")).toBeNull();
    expect(issuePlain.querySelector("textarea")).toBeNull();
    await expand("展开问题分组 设备");
    await expand("展开问题分组 未分类");
    await expand("展开下周分组 形态学");
    await expand("展开下周分组 未分类");
    expect(issueDevice.querySelector("textarea")?.value).toBe("【设备】账号锁定");
    expect(issuePlain.querySelector("textarea")?.value).toBe("需要值班手册");
    expect(issueDevice.textContent).not.toContain("需要值班手册");
    expect(issuePlain.textContent).not.toContain("账号锁定");
    expect(issues.querySelector('input[placeholder="标题"]')).toBeNull();
    expect(issues.querySelector('textarea[placeholder="标题"]')).toBeNull();
    expect(issues.querySelector('[aria-label^="问题标题"]')).toBeNull();
    expect(issues.querySelector('[aria-label="标题"]')).toBeNull();
    expect(issues.querySelector('[aria-label^="标题"]')).toBeNull();
    expect(issues.querySelector('input[placeholder="项目"]')).toBeNull();
    expect(issues.textContent).not.toContain("【别的】登录失败");
    expect(plans.querySelector('input[placeholder="标题"]')).toBeNull();
    expect(plans.querySelector('textarea[placeholder="标题"]')).toBeNull();
    expect(plans.querySelector('[aria-label^="问题标题"]')).toBeNull();
    expect(plans.querySelector('[aria-label="标题"]')).toBeNull();
    expect(plans.querySelector('[aria-label^="标题"]')).toBeNull();
    expect(current.issues.items[0].title).toBe("【别的】登录失败");
    expect(plans.querySelector('[aria-label^="下周项目"]')).toBeNull();
    expect(plans.querySelector('input[placeholder="项目"]')).toBeNull();
    expect(plans.querySelector(".issue-partition-body .project-head")).toBeNull();
    expect(current.nextWeek.find((row) => row.id === "n1")?.projectName).toBe("形态学");
    expect(current.nextWeek.find((row) => row.id === "n2")?.projectName).toBe("其他计划");
    expect((plans.querySelector('[aria-label="下周分组 形态学"] textarea') as HTMLTextAreaElement).value).toBe(
      "【形态学】压测",
    );
    expect((plans.querySelector('[aria-label="下周分组 未分类"] textarea') as HTMLTextAreaElement).value).toBe("回归");
    expect(current.projects.map((item) => item.bullets)).toEqual([["联调"], ["对账"]]);
    expect(current.issues.items[0].text).toBe("【设备】账号锁定");

    await act(async () => {
      (issueDevice.querySelector('button[aria-label="收起问题分组 设备"]') as HTMLButtonElement).click();
    });
    expect(issueDevice.querySelector("textarea")).toBeNull();
    expect(issuePlain.querySelector("textarea")?.value).toBe("需要值班手册");
    await act(async () => {
      (document.querySelector('button[aria-label="展开问题分组 设备"]') as HTMLButtonElement).click();
    });
    expect(issueDevice.querySelector("textarea")?.value).toBe("【设备】账号锁定");

    const projects = current.projects;
    expect((plans.querySelector('[aria-label="下周分组 形态学"] input.issue-partition-name') as HTMLInputElement).value).toBe(
      "形态学",
    );
    expect(current.projects).toBe(projects);
    await act(async () => {
      setControl(plans.querySelector('[aria-label="下周分组 未分类"] textarea') as HTMLTextAreaElement, "仍无括号");
    });
    expect(current.nextWeek.find((row) => row.id === "n2")?.projectName).toBe("未分类");
    expect(current.projects).toBe(projects);
    await act(async () => {
      setControl(
        plans.querySelector('[aria-label="下周分组 未分类"] textarea') as HTMLTextAreaElement,
        "【设备】补充回归",
      );
    });
    expect(current.nextWeek.find((row) => row.id === "n2")?.projectName).toBe("设备");
    expect(current.nextWeek.find((row) => row.id === "n2")?.items).toEqual(["【设备】补充回归"]);
    expect(current.projects).toBe(projects);
    expect(current.nextWeek.find((row) => row.id === "n1")?.projectName).toBe("形态学");
    expect(plans.querySelector('[aria-label^="下周项目"]')).toBeNull();
  });

  it("merges inside 问题 and 下周, then undoes without touching project bullets", async () => {
    await mount();
    const before = snapshot();
    const projects = current.projects;
    const nextWeekAfterFill = current.nextWeek;
    await act(async () => {
      (document.querySelector('input[aria-label="选择问题分区 设备"]') as HTMLInputElement).click();
    });
    await act(async () => {
      (document.querySelector('input[aria-label="选择问题分区 未分类"]') as HTMLInputElement).click();
    });
    expect(buttons("合并")[0].disabled).toBe(false);
    await act(async () => {
      buttons("合并")[0].click();
    });
    expect(current.issues.items).toHaveLength(1);
    expect(current.issues.items[0].text).toBe("账号锁定\n需要值班手册");
    expect(current.projects).toBe(projects);
    expect(current.projects).toEqual(before.projects);
    expect(current.nextWeek).toBe(nextWeekAfterFill);
    expect(buttons("撤销本次合并")[0].disabled).toBe(false);

    await act(async () => {
      buttons("撤销本次合并")[0].click();
    });
    expect(current.issues.items.map((item) => item.id)).toEqual(["i1", "i2"]);
    expect(current.projects[0].bullets).toEqual(["联调"]);

    await act(async () => {
      (document.querySelector('input[aria-label="选择下周分区 形态学"]') as HTMLInputElement).click();
    });
    await act(async () => {
      (document.querySelector('input[aria-label="选择下周分区 未分类"]') as HTMLInputElement).click();
    });
    await act(async () => {
      buttons("合并")[0].click();
    });
    expect(current.nextWeek).toHaveLength(1);
    expect(current.nextWeek[0]).toMatchObject({
      projectName: "形态学",
      items: ["【形态学】压测", "【形态学】回归"],
    });
    expect(current.projects).toBe(projects);
    expect(current.projects.map((item) => item.bullets)).toEqual([["联调"], ["对账"]]);
    expect(current.issues.items.map((item) => item.text)).toEqual(["【设备】账号锁定", "需要值班手册"]);
    await act(async () => {
      buttons("撤销本次合并")[0].click();
    });
    expect(current.nextWeek.map((item) => item.id)).toEqual(["n1", "n2"]);
  });
});
