import { describe, expect, it } from "vitest";
import {
  UNTAGGED_LABEL,
  firstBracketTag,
  groupByDisplayTag,
  issueDisplayTag,
  nextWeekDisplayTag,
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
  it("groups inside the zone and does not invent a project write", () => {
    const issues = [
      { id: "i1", title: "【设备】登录失败", text: "账号锁定" },
      { id: "i2", title: "无标签", text: "补充说明" },
      { id: "i3", text: "见【设备】日志" },
    ];
    expect(issues.map(issueDisplayTag)).toEqual(["设备", UNTAGGED_LABEL, "设备"]);
    expect(groupByDisplayTag(issues, issueDisplayTag).map((group) => ({
      tag: group.tag,
      ids: group.items.map((item) => item.id),
    }))).toEqual([
      { tag: "设备", ids: ["i1", "i3"] },
      { tag: UNTAGGED_LABEL, ids: ["i2"] },
    ]);
    expect(issues[0].text).toBe("账号锁定");

    const plans = [
      { id: "n1", projectName: "下周", items: ["【形态学】压测"] },
      { id: "n2", projectName: "其他", items: ["回归"] },
    ];
    expect(plans.map(nextWeekDisplayTag)).toEqual(["形态学", UNTAGGED_LABEL]);
    expect(plans[0].items).toEqual(["【形态学】压测"]);
  });
});
