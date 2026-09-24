import { describe, expect, it } from "vitest";
import {
  canMergeSelection,
  confirmMergeOptions,
  mergeZoneItems,
  pickMergeTitle,
  prefixLine,
  setPrimary,
  toggleSelection,
  zonesToConfirmMaterials,
  type ZoneSnapshot,
} from "./zoneMerge";

function snapshot(): ZoneSnapshot {
  return {
    projects: [
      {
        id: "p1",
        name: "设备",
        bullets: ["协议联调"],
        status: "in_progress",
        statusLabel: "进行中",
        owner: "张三",
        sourceId: "s1",
        mergeLines: [{ text: "协议联调", statusLabel: "进行中", owner: "张三", sourceId: "s1" }],
      },
      {
        id: "p2",
        name: "设备管理",
        bullets: ["提测固件", "协议联调"],
        status: "launched",
        sourceIds: ["s2"],
        mergeLines: [
          { text: "提测固件", statusLabel: "已完成", sourceId: "s2" },
          { text: "协议联调", owner: "李四", sourceId: "s2b" },
        ],
      },
      { id: "p3", name: "ERP", bullets: ["对账"], status: "support", sourceId: "s3" },
    ],
    issues: {
      empty: false,
      items: [
        { id: "i1", title: "登录失败", text: "登录失败", statusLabel: "待处理", sourceId: "b1" },
        { id: "i2", title: "固件崩溃", text: "补充说明", owner: "王五", sourceId: "b2" },
      ],
    },
    nextWeek: [
      { id: "n1", projectName: "", items: ["压测"], sourceId: "n-src-1", mergeLines: [{ text: "压测", statusLabel: "待处理", sourceId: "n-src-1" }] },
      { id: "n2", projectName: "设备管理", items: ["提测", "压测"], sourceId: "n-src-2" },
    ],
  };
}

describe("manual zone merge", () => {
  it("picks the longer formal name, then 主项 when lengths tie", () => {
    expect(pickMergeTitle([{ id: "a", title: "设备" }, { id: "b", title: "设备管理" }], "a")).toBe("设备管理");
    expect(pickMergeTitle([{ id: "a", title: "采购" }, { id: "b", title: "财务" }], "b")).toBe("财务");
    expect(pickMergeTitle([{ id: "a", title: "采购" }, { id: "b", title: "财务" }], "a")).toBe("采购");
    expect(pickMergeTitle([{ id: "a", title: "  " }, { id: "b", title: "ERP" }], "a")).toBe("ERP");
    expect(prefixLine("协议联调", "进行中", "张三")).toBe("[进行中·张三] 协议联调");
    expect(prefixLine("协议联调", "进行中")).toBe("[进行中] 协议联调");
    expect(prefixLine("协议联调", undefined, "张三")).toBe("[张三] 协议联调");
    expect(prefixLine("协议联调")).toBe("协议联调");
    expect(prefixLine("[进行中·张三] 协议联调", "进行中", "张三")).toBe("[进行中·张三] 协议联调");
  });

  it("merges projects by length, selection order, and source ids", () => {
    const before = snapshot();
    const after = mergeZoneItems(before, "projects", ["p2", "p1"], "p2");
    expect(before.projects).toHaveLength(3);
    expect(after.projects).toHaveLength(2);
    expect(after.projects[0].name).toBe("设备管理");
    expect(after.projects[0].bullets).toEqual([
      "[已完成] 提测固件",
      "[李四] 协议联调",
      "[进行中·张三] 协议联调",
    ]);
    expect(after.projects[0].status).toBe("launched");
    expect(after.projects[0].sourceIds).toEqual(["s2", "s2b", "s1"]);
    expect(after.projects[0].statusLabel).toBeUndefined();
    expect(after.projects[1].id).toBe("p3");
    expect(after.issues).toEqual(before.issues);
    expect(after.nextWeek).toEqual(before.nextWeek);
  });

  it("uses 主项 when formal names are the same length, and keeps that item's status", () => {
    const before = snapshot();
    const tie = mergeZoneItems(
      {
        ...before,
        projects: [
          { id: "a", name: "采购", bullets: ["甲"], status: "in_progress", sourceId: "a1" },
          { id: "b", name: "财务", bullets: ["乙"], status: "support", sourceId: "b1" },
        ],
      },
      "projects",
      ["a", "b"],
      "b",
    );
    expect(tie.projects[0].name).toBe("财务");
    expect(tie.projects[0].status).toBe("support");
    expect(tie.projects[0].bullets).toEqual(["甲", "乙"]);
    expect(tie.projects[0].sourceIds).toEqual(["a1", "b1"]);
  });

  it("keeps a strictly longer title even when 主项 is shorter", () => {
    const before = snapshot();
    const after = mergeZoneItems(before, "projects", ["p1", "p2"], "p1");
    expect(after.projects[0].name).toBe("设备管理");
    expect(after.projects[0].status).toBe("in_progress");
    expect(after.projects[0].bullets[0]).toBe("[进行中·张三] 协议联调");
  });

  it("concatenates issue and plan bodies in selection order without dropping duplicates", () => {
    const before = snapshot();
    const issues = mergeZoneItems(before, "issues", ["i2", "i1"], "i1");
    expect(issues.issues.empty).toBe(false);
    expect(issues.issues.items).toHaveLength(1);
    expect(issues.issues.items[0].title).toBe("登录失败");
    expect(issues.issues.items[0].text).toBe("[王五] 补充说明\n[待处理] 登录失败");
    expect(issues.issues.items[0].sourceIds).toEqual(["b2", "b1"]);
    expect(issues.projects).toEqual(before.projects);

    const plan = mergeZoneItems(before, "nextWeek", ["n2", "n1"], "n2");
    expect(plan.nextWeek).toHaveLength(1);
    expect(plan.nextWeek[0].projectName).toBe("设备管理");
    expect(plan.nextWeek[0].items).toEqual(["提测", "压测", "[待处理] 压测"]);
    expect(plan.nextWeek[0].sourceIds).toEqual(["n-src-2", "n-src-1"]);
    expect(plan.issues).toEqual(before.issues);
  });

  it("rejects fewer than two ids or ids from another zone", () => {
    const before = snapshot();
    expect(() => mergeZoneItems(before, "projects", ["p1"])).toThrow(/至少选择 2 条/);
    expect(() => mergeZoneItems(before, "projects", ["p1", "i1"])).toThrow(/同一分区/);
  });

  it("sends materials only when the preview differs from the untouched snapshot", () => {
    const before = snapshot();
    const merged = mergeZoneItems(before, "projects", ["p1", "p2"], "p1");
    expect(confirmMergeOptions(true, before, before)).toEqual({ moduleAutoMerge: true });
    expect(confirmMergeOptions(false, before, before)).toEqual({ moduleAutoMerge: false });
    const dirty = confirmMergeOptions(false, merged, before);
    expect(dirty.moduleAutoMerge).toBe(false);
    expect(dirty.zones).toBe(merged);
    expect(zonesToConfirmMaterials(merged).issues).toEqual(before.issues.items);
    expect(zonesToConfirmMaterials({ ...before, issues: { empty: true, items: before.issues.items } }).issues).toEqual([]);
    expect(confirmMergeOptions(true, merged, before)).not.toHaveProperty("undo");
  });

  it("blocks cross-zone selection and keeps 主项 as the first checked id", () => {
    const first = toggleSelection({ zone: null, ids: [], primaryId: null }, "projects", "p1");
    expect(first.error).toBeNull();
    expect(first.selection).toEqual({ zone: "projects", ids: ["p1"], primaryId: "p1" });
    expect(canMergeSelection(first.selection)).toBe(false);
    const second = toggleSelection(first.selection, "issues", "i1");
    expect(second.error).toBe("只能合并同一分区内的条目");
    expect(second.selection).toEqual(first.selection);
    const same = toggleSelection(first.selection, "projects", "p2");
    expect(same.selection).toEqual({ zone: "projects", ids: ["p1", "p2"], primaryId: "p1" });
    expect(canMergeSelection(same.selection)).toBe(true);
    const marked = setPrimary(same.selection, "p2");
    expect(marked.primaryId).toBe("p2");
    const clearedPrimary = toggleSelection(marked, "projects", "p2");
    expect(clearedPrimary.selection.primaryId).toBe("p1");
    const empty = toggleSelection(clearedPrimary.selection, "projects", "p1");
    expect(empty.selection).toEqual({ zone: null, ids: [], primaryId: null });
  });
});
