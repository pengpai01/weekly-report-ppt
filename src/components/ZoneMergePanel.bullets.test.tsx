/**
 * @vitest-environment happy-dom
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import type { ZoneSnapshot } from "../lib/zoneMerge";
import { bulletsFromLines, ZoneMergePanel } from "./ZoneMergePanel";

let root: Root | undefined;
let host: HTMLDivElement | undefined;

const sample = (): ZoneSnapshot => ({
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
    { id: "p2", name: "ERP", bullets: ["对账"] },
  ],
  issues: { empty: false, items: [{ id: "i1", text: "登录失败" }] },
  nextWeek: [{ id: "n1", projectName: "设备管理", items: ["压测"] }],
});

function Host({
  initial,
  onSnapshot,
}: {
  initial: ZoneSnapshot;
  onSnapshot?: (next: ZoneSnapshot) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ZoneMergePanel
      value={value}
      onChange={(next) => {
        onSnapshot?.(next);
        setValue(next);
      }}
    />
  );
}

async function mount(initial: ZoneSnapshot, onSnapshot?: (next: ZoneSnapshot) => void) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<Host initial={initial} onSnapshot={onSnapshot} />);
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

async function setField(field: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function blurField(field: HTMLTextAreaElement) {
  await act(async () => {
    field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

describe("bulletsFromLines", () => {
  it("splits on newlines and drops blank lines", () => {
    expect(bulletsFromLines("甲\n乙")).toEqual(["甲", "乙"]);
    expect(bulletsFromLines("甲\r\n\r\n乙\n  \n丙")).toEqual(["甲", "乙", "丙"]);
    expect(bulletsFromLines("")).toEqual([]);
    expect(bulletsFromLines("\n\n")).toEqual([]);
    expect(bulletsFromLines("  保留空格  ")).toEqual(["  保留空格  "]);
  });
});

describe("project bullets textarea", () => {
  it("edits every bullet in one field and stores non-empty lines", async () => {
    const seen: ZoneSnapshot[] = [];
    await mount(sample(), (next) => seen.push(next));

    expect(document.querySelector("textarea.project-bullets-input")).toBeNull();
    expect(document.body.textContent).not.toContain("联调");

    await expand("设备管理");
    const field = bulletsField("设备管理");
    expect(field.value).toBe("联调\n上线");
    expect(document.querySelectorAll("textarea.project-bullets-input")).toHaveLength(1);
    expect(document.body.textContent).not.toContain("添加要点");
    expect(document.body.textContent).not.toContain("删除要点");

    await setField(field, "联调\n\n验收\n   \n上线");
    expect(field.value).toBe("联调\n\n验收\n   \n上线");
    expect(seen).toHaveLength(1);
    expect(seen[0].projects[0].bullets).toEqual(["联调", "验收", "上线"]);
    expect(seen[0].projects[0].mergeLines).toBeUndefined();
    expect(seen[0].projects[0].statusLabel).toBeUndefined();
    expect(seen[0].projects[0].owner).toBeUndefined();
    expect(seen[0].projects[0].status).toBe("in_progress");
    expect(seen[0].projects[1]).toEqual(sample().projects[1]);
    expect(seen[0].issues).toEqual(sample().issues);
    expect(seen[0].nextWeek).toEqual(sample().nextWeek);

    await blurField(field);
    expect(bulletsField("设备管理").value).toBe("联调\n验收\n上线");
  });

  it("keeps an empty field and restores the same lines after a remount", async () => {
    let current = sample();
    const remember = (next: ZoneSnapshot) => {
      current = next;
    };
    await mount(current, remember);
    await expand("设备管理");
    await setField(bulletsField("设备管理"), "");
    expect(current.projects[0].bullets).toEqual([]);

    await act(async () => {
      root?.unmount();
    });
    host?.remove();
    await mount(current, remember);
    expect(document.querySelector("textarea.project-bullets-input")).toBeNull();
    expect(document.body.textContent).toContain("0 条");
    await expand("设备管理");
    expect(bulletsField("设备管理").value).toBe("");

    await setField(bulletsField("设备管理"), "甲\n\n乙");
    expect(current.projects[0].bullets).toEqual(["甲", "乙"]);
    await act(async () => {
      root?.unmount();
    });
    host?.remove();
    await mount(current);
    expect(document.body.textContent).toContain("2 条");
    await expand("设备管理");
    expect(bulletsField("设备管理").value).toBe("甲\n乙");
  });

  it("does not write the draft when the line list is unchanged", async () => {
    let calls = 0;
    await mount(sample(), () => {
      calls += 1;
    });
    await expand("设备管理");
    await setField(bulletsField("设备管理"), "联调\n上线\n");
    expect(calls).toBe(0);
    expect(bulletsField("设备管理").value).toBe("联调\n上线\n");
    await blurField(bulletsField("设备管理"));
    expect(bulletsField("设备管理").value).toBe("联调\n上线");
    expect(calls).toBe(0);
  });
});
