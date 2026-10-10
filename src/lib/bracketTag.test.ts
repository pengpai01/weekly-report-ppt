import { describe, expect, it } from "vitest";
import {
  UNTAGGED_LABEL,
  applyNextWeekProjectName,
  firstBracketTag,
  groupByDisplayTag,
  issueDisplayTag,
  nextWeekDisplayTag,
  nextWeekProjectNameFromItems,
} from "./bracketTag";

describe("firstBracketTag", () => {
  it("uses the first non-empty pair and leaves the source text alone", () => {
    const text = "前文【】然后【 设备 】正文【其他】";
    expect(firstBracketTag(text)).toBe("设备");
    expect(text).toBe("前文【】然后【 设备 】正文【其他】");
    expect(firstBracketTag("没有成对括号【设备")).toBeNull();
    expect(firstBracketTag("")).toBeNull();
  });
});

describe("zone display tags", () => {
  it("partitions issues by the body 【】 and does not invent a project write", () => {
    const issues = [
      { id: "i1", title: "【别的】登录失败", text: "【设备】账号锁定" },
      { id: "i2", title: "无标签", text: "补充说明" },
      { id: "i3", title: "【设备】仅旧标题", text: "见日志" },
    ];
    expect(issues.map(issueDisplayTag)).toEqual(["设备", UNTAGGED_LABEL, "设备"]);
    expect(groupByDisplayTag(issues, issueDisplayTag).map((group) => ({
      tag: group.tag,
      ids: group.items.map((item) => item.id),
    }))).toEqual([
      { tag: "设备", ids: ["i1", "i3"] },
      { tag: UNTAGGED_LABEL, ids: ["i2"] },
    ]);
    expect(issues[0].text).toBe("【设备】账号锁定");
    expect(issues[0].title).toBe("【别的】登录失败");

    const plans = [
      { id: "n1", projectName: "下周", items: ["【形态学】压测"] },
      { id: "n2", projectName: "其他", items: ["回归"] },
    ];
    expect(plans.map(nextWeekDisplayTag)).toEqual(["形态学", UNTAGGED_LABEL]);
    expect(plans[0].items).toEqual(["【形态学】压测"]);
    expect(plans.map((row) => row.projectName)).toEqual(["下周", "其他"]);
  });
});

describe("nextWeekProjectNameFromItems", () => {
  it("writes the first pair, 未分类 when text has none, and leaves a blank body alone", () => {
    expect(nextWeekProjectNameFromItems(["前文【】然后【 设备 】正文"])).toBe("设备");
    expect(nextWeekProjectNameFromItems(["回归"])).toBe(UNTAGGED_LABEL);
    expect(nextWeekProjectNameFromItems([""])).toBeNull();
    expect(nextWeekProjectNameFromItems(["  ", ""])).toBeNull();

    const named = { projectName: "智慧仪器管理系统", items: ["推广支持"] };
    expect(applyNextWeekProjectName(named, "load")).toBe(named);
    expect(applyNextWeekProjectName({ projectName: "", items: ["回归"] }, "load").projectName).toBe(UNTAGGED_LABEL);
    expect(applyNextWeekProjectName({ projectName: "【形态学】下周", items: ["【形态学】压测"] }, "load").projectName).toBe(
      "形态学",
    );
    expect(applyNextWeekProjectName(named, "edit").projectName).toBe(UNTAGGED_LABEL);
    expect(applyNextWeekProjectName({ projectName: "带入的名字", items: [""] }, "edit")).toMatchObject({
      projectName: "带入的名字",
    });
  });
});
