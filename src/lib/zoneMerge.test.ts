import { describe, expect, it } from "vitest";
import {
  appendBodies,
  canMergeSelection,
  combineTitles,
  mergeZoneItems,
  toggleSelection,
  type ZoneSnapshot,
} from "./zoneMerge";

function snapshot(): ZoneSnapshot {
  return {
    projects: [
      { id: "p1", name: "设备", bullets: ["协议联调"], status: "in_progress" },
      { id: "p2", name: "设备管理", bullets: ["提测固件", "协议联调"], status: "launched" },
      { id: "p3", name: "ERP", bullets: ["对账"], status: "support" },
    ],
    issues: {
      empty: false,
      items: [
        { id: "i1", text: "登录失败" },
        { id: "i2", text: "固件崩溃" },
      ],
    },
    nextWeek: [
      { id: "n1", projectName: "设备", items: ["压测"] },
      { id: "n2", projectName: "设备管理", items: ["提测", "压测"] },
    ],
  };
}

describe("manual zone merge", () => {
  it("combines titles by containment or enumeration", () => {
    expect(combineTitles(["设备", "设备管理"])).toBe("设备管理");
    expect(combineTitles(["形态学鉴定APP", "形态学"])).toBe("形态学鉴定APP");
    expect(combineTitles(["ERP", "设备管理"])).toBe("ERP、设备管理");
    expect(combineTitles(["  ", "ERP", "ERP"])).toBe("ERP");
    expect(appendBodies([["甲", ""], ["甲", "乙"]])).toEqual(["甲", "乙"]);
  });

  it("merges projects in one zone, appends bullets, and leaves other zones", () => {
    const before = snapshot();
    const after = mergeZoneItems(before, "projects", ["p1", "p2"]);
    expect(before.projects).toHaveLength(3);
    expect(after.projects).toHaveLength(2);
    expect(after.projects[0].name).toBe("设备管理");
    expect(after.projects[0].bullets).toEqual(["协议联调", "提测固件"]);
    expect(after.projects[0].status).toBe("in_progress");
    expect(after.projects[1].id).toBe("p3");
    expect(after.issues).toEqual(before.issues);
    expect(after.nextWeek).toEqual(before.nextWeek);
    expect(after.projects[0].id).not.toBe("p1");
  });

  it("appends issue text and plan items without crossing zones", () => {
    const before = snapshot();
    const issues = mergeZoneItems(before, "issues", ["i1", "i2"]);
    expect(issues.issues.empty).toBe(false);
    expect(issues.issues.items).toHaveLength(1);
    expect(issues.issues.items[0].text).toBe("登录失败\n固件崩溃");
    expect(issues.projects).toEqual(before.projects);

    const plan = mergeZoneItems(before, "nextWeek", ["n1", "n2"]);
    expect(plan.nextWeek).toHaveLength(1);
    expect(plan.nextWeek[0].projectName).toBe("设备管理");
    expect(plan.nextWeek[0].items).toEqual(["压测", "提测"]);
    expect(plan.issues).toEqual(before.issues);
  });

  it("rejects fewer than two ids or ids from another zone", () => {
    const before = snapshot();
    expect(() => mergeZoneItems(before, "projects", ["p1"])).toThrow(/至少选择 2 条/);
    expect(() => mergeZoneItems(before, "projects", ["p1", "i1"])).toThrow(/同一分区/);
  });

  it("blocks cross-zone selection and allows merge only at two or more", () => {
    const first = toggleSelection({ zone: null, ids: [] }, "projects", "p1");
    expect(first.error).toBeNull();
    expect(canMergeSelection(first.selection)).toBe(false);
    const second = toggleSelection(first.selection, "issues", "i1");
    expect(second.error).toBe("只能合并同一分区内的条目");
    expect(second.selection).toEqual(first.selection);
    const same = toggleSelection(first.selection, "projects", "p2");
    expect(same.error).toBeNull();
    expect(canMergeSelection(same.selection)).toBe(true);
    const cleared = toggleSelection(same.selection, "projects", "p1");
    const empty = toggleSelection(cleared.selection, "projects", "p2");
    expect(empty.selection).toEqual({ zone: null, ids: [] });
  });
});
