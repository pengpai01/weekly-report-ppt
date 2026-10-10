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
      { id: "p1", name: "设备管理", bullets: ["联调", "上线"], status: "in_progress" },
      { id: "p2", name: "ERP", bullets: ["对账"] },
    ],
    issues: { empty: false, items: [{ id: "i1", title: "登录失败", text: "登录失败" }] },
    nextWeek: [{ id: "n1", projectName: "设备管理", items: ["压测"] }],
  };
}

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

describe("project bullets list", () => {
  it("keeps one textarea and does not offer 移到其他项目", async () => {
    await mount();
    expect(document.body.textContent).not.toContain("移到其他项目");
    expect(document.querySelector(".bullet-move-row")).toBeNull();
    expect(document.querySelector('summary[aria-label="更多 设备管理"]')?.parentElement?.textContent).toContain("删除项目");
    expect(document.querySelector('summary[aria-label="更多 设备管理"]')?.parentElement?.textContent).not.toContain(
      "移到其他项目",
    );

    await act(async () => {
      (document.querySelector('button[aria-label="展开 设备管理"]') as HTMLButtonElement).click();
    });
    const device = [...document.querySelectorAll("article.project-card")].find((node) =>
      Boolean(node.querySelector('input[placeholder="项目名称 *"]')),
    ) as HTMLElement;
    const field = device.querySelector("textarea.project-bullets-input") as HTMLTextAreaElement;
    expect(field.value).toBe("联调\n上线");
    expect(device.querySelector(".bullet-move-row")).toBeNull();
    expect(device.querySelector(".bullet-row")).toBeNull();
    expect(device.textContent).not.toContain("移到其他项目");
    expect(document.querySelector('summary[aria-label="更多 问题 1"]')?.textContent).not.toContain("移到其他项目");
    expect(document.querySelector('summary[aria-label="更多 下周计划 设备管理"]')?.textContent).not.toContain("移到其他项目");
    expect(document.querySelector('button[aria-label="收起 设备管理"]')?.getAttribute("aria-expanded")).toBe("true");
  });
});
