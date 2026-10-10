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
        { id: "i1", title: "【设备】登录失败", text: "【设备】账号锁定" },
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

describe("issue and next-week tags", () => {
  it("groups by the first 【】 and keeps bodies and projects unchanged", async () => {
    await mount();
    const issueDevice = document.querySelector('[aria-label="问题分组 设备"]') as HTMLElement;
    const issuePlain = document.querySelector('[aria-label="问题分组 未分类"]') as HTMLElement;
    expect(issueDevice.querySelector("textarea")?.value).toBe("【设备】账号锁定");
    expect(issuePlain.querySelector("textarea")?.value).toBe("需要值班手册");
    expect((document.querySelector('[aria-label="下周分组 形态学"] textarea') as HTMLTextAreaElement).value).toBe(
      "【形态学】压测",
    );
    expect((document.querySelector('[aria-label="下周分组 未分类"] textarea') as HTMLTextAreaElement).value).toBe(
      "回归",
    );
    expect(current.projects.map((item) => item.bullets)).toEqual([["联调"], ["对账"]]);
    expect(current.issues.items[0].text).toBe("【设备】账号锁定");
  });

  it("merges inside 问题 and 下周, then undoes without touching project bullets", async () => {
    await mount();
    const before = snapshot();
    await act(async () => {
      (document.querySelector('input[aria-label="选择问题 1"]') as HTMLInputElement).click();
    });
    await act(async () => {
      (document.querySelector('input[aria-label="选择问题 2"]') as HTMLInputElement).click();
    });
    expect(buttons("合并")[0].disabled).toBe(false);
    await act(async () => {
      buttons("合并")[0].click();
    });
    expect(current.issues.items).toHaveLength(1);
    expect(current.projects).toEqual(before.projects);
    expect(current.nextWeek).toEqual(before.nextWeek);
    expect(buttons("撤销本次合并")[0].disabled).toBe(false);

    await act(async () => {
      buttons("撤销本次合并")[0].click();
    });
    expect(current.issues.items.map((item) => item.id)).toEqual(["i1", "i2"]);
    expect(current.projects[0].bullets).toEqual(["联调"]);

    await act(async () => {
      (document.querySelector('input[aria-label="选择下周计划 【形态学】下周"]') as HTMLInputElement).click();
    });
    await act(async () => {
      (document.querySelector('input[aria-label="选择下周计划 其他计划"]') as HTMLInputElement).click();
    });
    await act(async () => {
      buttons("合并")[0].click();
    });
    expect(current.nextWeek).toHaveLength(1);
    expect(current.projects.map((item) => item.bullets)).toEqual([["联调"], ["对账"]]);
    expect(current.issues.items.map((item) => item.text)).toEqual(["【设备】账号锁定", "需要值班手册"]);
    await act(async () => {
      buttons("撤销本次合并")[0].click();
    });
    expect(current.nextWeek.map((item) => item.id)).toEqual(["n1", "n2"]);
  });
});
