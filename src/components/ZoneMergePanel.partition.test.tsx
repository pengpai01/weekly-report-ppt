/**
 * @vitest-environment happy-dom
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

function snapshot(): ZoneSnapshot {
  return {
    projects: [{ id: "p1", name: "设备管理", bullets: ["联调"], status: "in_progress" }],
    issues: {
      empty: false,
      items: [
        { id: "i1", title: "【别的】登录失败", text: "【设备】账号锁定" },
        { id: "i2", text: "【形态学】需要手册" },
      ],
    },
    nextWeek: [
      { id: "n1", projectName: "形态学", items: ["【形态学】压测"] },
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

function visibleLabel(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("input, textarea").forEach((node) => node.remove());
  return clone.textContent ?? "";
}

function setControl(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

async function commitName(field: HTMLInputElement, value: string) {
  await act(async () => {
    setControl(field, value);
    field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

describe("partition headers", () => {
  it("edits, clears to 未分类, merges, reorders, and leaves projects untouched", async () => {
    await mount();
    const projects = current.projects;
    const issues = document.getElementById("merge-zone-issues") as HTMLElement;
    const plans = document.getElementById("merge-zone-nextWeek") as HTMLElement;
    const device = issues.querySelector('[aria-label="问题分组 设备"]') as HTMLElement;
    const name = device.querySelector("input.issue-partition-name") as HTMLInputElement;
    expect(device.querySelector("h4, .zone-tag-heading, .zone-item-tag")).toBeNull();
    expect(visibleLabel(device)).not.toContain("设备");
    expect(name.placeholder).toBe("项目名称 *");
    expect(name.value).toBe("设备");
    expect(name.closest(".issue-partition")).toBe(device);
    expect(plans.querySelector("h4, .zone-tag-heading, .zone-item-tag")).toBeNull();
    expect(visibleLabel(plans)).not.toContain("形态学");
    expect(device.querySelector('button[aria-label="一键总结问题分区 设备"]')).not.toBeNull();
    expect(device.querySelector('button[aria-label="一键总结 【设备】账号锁定"]')).not.toBeNull();

    await commitName(name, "仪器");
    expect(current.issues.items.find((item) => item.id === "i1")).toMatchObject({
      title: "【别的】登录失败",
      text: "【仪器】账号锁定",
    });
    expect(current.issues.items.find((item) => item.id === "i2")?.text).toBe("【形态学】需要手册");
    expect(current.projects).toBe(projects);
    expect(issues.querySelector('[aria-label="问题分组 仪器"] input.issue-partition-name')).not.toBeNull();

    const renamed = issues.querySelector('[aria-label="问题分组 仪器"] input.issue-partition-name') as HTMLInputElement;
    await commitName(renamed, "");
    expect(current.issues.items.find((item) => item.id === "i1")?.text).toBe("账号锁定");
    expect(current.issues.items.find((item) => item.id === "i1")?.text).not.toContain("【");
    expect((issues.querySelector('[aria-label="问题分组 未分类"] input.issue-partition-name') as HTMLInputElement).value).toBe(
      "未分类",
    );
    expect(current.projects).toBe(projects);

    await commitName(
      issues.querySelector('[aria-label="问题分组 未分类"] input.issue-partition-name') as HTMLInputElement,
      "设备",
    );
    const beforeMerge = current.issues.items.map((item) => ({ id: item.id, text: item.text, title: item.title }));
    await act(async () => {
      (issues.querySelector('input[aria-label="选择问题分区 设备"]') as HTMLInputElement).click();
    });
    await act(async () => {
      (issues.querySelector('input[aria-label="选择问题分区 形态学"]') as HTMLInputElement).click();
    });
    expect(buttons("合并")[0].disabled).toBe(false);
    await act(async () => {
      buttons("合并")[0].click();
    });
    expect(current.issues.items.map((item) => item.text)).toEqual(["【形态学】账号锁定", "【形态学】需要手册"]);
    expect(current.projects).toBe(projects);
    expect(buttons("撤销本次合并")[0].disabled).toBe(false);
    await act(async () => {
      buttons("撤销本次合并")[0].click();
    });
    expect(current.issues.items.map((item) => ({ id: item.id, text: item.text, title: item.title }))).toEqual(beforeMerge);
    expect(current.projects).toBe(projects);

    const deviceAgain = issues.querySelector('[aria-label="问题分组 设备"]') as HTMLElement;
    await act(async () => {
      buttons("下移", deviceAgain)[0].click();
    });
    expect(
      [...issues.querySelectorAll("[aria-label^='问题分组']")].map((node) => node.getAttribute("aria-label")),
    ).toEqual(["问题分组 形态学", "问题分组 设备"]);
    expect(current.projects).toBe(projects);

    const planName = plans.querySelector('[aria-label="下周分组 形态学"] input.issue-partition-name') as HTMLInputElement;
    expect(planName.placeholder).toBe("项目名称 *");
    await commitName(planName, "检验");
    expect(current.nextWeek.find((row) => row.id === "n1")).toMatchObject({
      projectName: "检验",
      items: ["【检验】压测"],
    });
    expect(current.nextWeek.find((row) => row.id === "n2")?.projectName).toBe("其他计划");
    expect(current.projects).toBe(projects);
    await commitName(
      plans.querySelector('[aria-label="下周分组 检验"] input.issue-partition-name') as HTMLInputElement,
      "   ",
    );
    expect(current.nextWeek.find((row) => row.id === "n1")).toMatchObject({
      projectName: "未分类",
      items: ["压测"],
    });
    expect(current.nextWeek.find((row) => row.id === "n1")?.items.join("")).not.toContain("【");
    expect(current.projects).toBe(projects);

    expect(issues.querySelector("textarea.next-week-body")).toBeNull();
    expect(plans.querySelector("textarea.next-week-body")).not.toBeNull();
    expect(document.querySelector("textarea.project-bullets-input")).toBeNull();
    expect(plans.querySelector('button[aria-label="一键总结下周分区 未分类"]')).not.toBeNull();
    expect(plans.querySelector('button[aria-label^="一键总结 【形态学】"]')).toBeNull();
    expect(plans.querySelector('button[aria-label="一键总结 未分类"]')).not.toBeNull();
  });

  it("keeps the full-width rule on the next-week body only", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../index.css"), "utf8");
    expect(css).toMatch(/#merge-zone-nextWeek textarea\.next-week-body\s*\{[^}]*width:\s*100%/);
    expect(css).not.toMatch(/#merge-zone-issues textarea/);
    expect(css).not.toMatch(/\.project-bullets-input\s*\{[^}]*grid-column/);
    expect(css).not.toContain(".zone-item-tag");
  });
});
