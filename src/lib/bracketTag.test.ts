import { describe, expect, it } from "vitest";
import {
  UNTAGGED_LABEL,
  applyNextWeekProjectName,
  canMergePartitions,
  chosenPartitionName,
  firstBracketTag,
  groupByDisplayTag,
  issueDisplayTag,
  collapseIssuePartitions,
  collapseNextWeekPartitions,
  mergeIssuePartitions,
  mergeNextWeekPartitions,
  movePartitionItems,
  nextWeekDisplayTag,
  nextWeekProjectNameFromItems,
  normalizePartitionName,
  renameIssuePartition,
  renameNextWeekPartition,
  togglePartitionSelection,
  writeIssuePartitionBody,
  writeNextWeekPartitionBody,
  EMPTY_PARTITION_SELECTION,
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

describe("partition rename and merge", () => {
  const issues = () => [
    { id: "i1", title: "【别的】登录失败", text: "【设备】账号锁定", owner: "李四" },
    { id: "i2", text: "【设备】需要手册" },
    { id: "i3", title: "【设备】仅旧标题", text: "见日志" },
    { id: "i4", text: "值班说明" },
  ];

  it("renames an issue partition by following 【】 and leaves other rows alone", () => {
    const source = issues();
    const next = renameIssuePartition(source, "设备", "仪器");
    expect(next.map((item) => item.text)).toEqual(["【仪器】账号锁定", "【仪器】需要手册", "见日志", "值班说明"]);
    expect(next[0].title).toBe("【别的】登录失败");
    expect(next[2].title).toBe("【仪器】仅旧标题");
    expect(next[0].owner).toBe("李四");
    expect(next[3]).toBe(source[3]);
    expect(source[0].text).toBe("【设备】账号锁定");
  });

  it("treats an empty issue name as 未分类 by removing the pair", () => {
    expect(normalizePartitionName("  ")).toBe(UNTAGGED_LABEL);
    expect(normalizePartitionName("【】")).toBe(UNTAGGED_LABEL);
    expect(normalizePartitionName(" 仪器 ")).toBe("仪器");
    const next = renameIssuePartition(issues(), "设备", "");
    expect(next.map(issueDisplayTag)).toEqual([UNTAGGED_LABEL, UNTAGGED_LABEL, UNTAGGED_LABEL, UNTAGGED_LABEL]);
    expect(next[0].text).toBe("账号锁定");
    expect(next[0].text).not.toContain("【");
    expect(next[0].title).toBe("登录失败");
    expect(next[2].title).toBe("仅旧标题");
    expect(renameIssuePartition(next, UNTAGGED_LABEL, "仪器")[0].text).toBe("【仪器】账号锁定");
  });

  it("writes next-week projectName and follows 【】 without an empty name", () => {
    const rows = [
      { id: "n1", projectName: "形态学", items: ["【形态学】压测", "补充"] },
      { id: "n2", projectName: "其他计划", items: ["回归"] },
    ];
    const renamed = renameNextWeekPartition(rows, "形态学", "检验");
    expect(renamed[0]).toMatchObject({ projectName: "检验", items: ["【检验】压测", "补充"] });
    expect(renamed[1]).toBe(rows[1]);
    const cleared = renameNextWeekPartition(renamed, "检验", " ");
    expect(cleared[0]).toMatchObject({ projectName: UNTAGGED_LABEL, items: ["压测", "补充"] });
    expect(cleared[0].items.join("")).not.toContain("【");
    expect(nextWeekDisplayTag(cleared[0])).toBe(UNTAGGED_LABEL);
    const named = renameNextWeekPartition(rows, UNTAGGED_LABEL, "采购");
    expect(named[1]).toMatchObject({ projectName: "采购", items: ["【采购】回归"] });
    expect(named[0]).toBe(rows[0]);
  });

  it("merges partitions with the longer name, then the primary, and can move a block", () => {
    const source = issues();
    expect(chosenPartitionName(["设备", "形态学"], "设备")).toBe("形态学");
    expect(chosenPartitionName(["设备", "采购"], "采购")).toBe("采购");
    expect(chosenPartitionName(["设备", UNTAGGED_LABEL], "设备")).toBe(UNTAGGED_LABEL);
    const merged = mergeIssuePartitions(source, ["设备", UNTAGGED_LABEL], "设备");
    expect(merged).toHaveLength(1);
    expect(issueDisplayTag(merged[0])).toBe(UNTAGGED_LABEL);
    expect(merged[0].id).toBe("i1");
    expect(merged[0].text).toBe("账号锁定\n需要手册\n见日志\n值班说明");
    expect(source.map((item) => item.text)).toEqual(["【设备】账号锁定", "【设备】需要手册", "见日志", "值班说明"]);
    expect(mergeIssuePartitions(source, ["设备"], null)).toBe(source);

    const plans = [
      { id: "n1", projectName: "形态学", items: ["【形态学】压测"] },
      { id: "n2", projectName: "其他计划", items: ["回归"] },
    ];
    const planMerge = mergeNextWeekPartitions(plans, ["形态学", UNTAGGED_LABEL], "形态学");
    expect(planMerge).toEqual([
      { id: "n1", projectName: "形态学", items: ["【形态学】压测", "【形态学】回归"] },
    ]);
    expect(plans[0].items).toEqual(["【形态学】压测"]);

    const moved = movePartitionItems(source, "设备", 1, issueDisplayTag);
    expect(moved.map((item) => item.id)).toEqual(["i4", "i1", "i2", "i3"]);
    expect(movePartitionItems(source, "设备", -1, issueDisplayTag)).toBe(source);

    let selection = EMPTY_PARTITION_SELECTION;
    selection = togglePartitionSelection(selection, "issues", "设备").selection;
    selection = togglePartitionSelection(selection, "issues", UNTAGGED_LABEL).selection;
    expect(canMergePartitions(selection)).toBe(true);
    expect(selection.primaryTag).toBe("设备");
    expect(togglePartitionSelection(selection, "nextWeek", "形态学").error).toBe("只能合并同一分区内的条目");
  });

  it("collapses same 【】 into one row and writes back only that row", () => {
    const source = issues();
    const collapsed = collapseIssuePartitions(source);
    expect(collapsed.map((item) => item.id)).toEqual(["i1", "i4"]);
    expect(collapsed[0].text).toBe("【设备】账号锁定\n【设备】需要手册\n见日志");
    expect(issueDisplayTag(collapsed[0])).toBe("设备");
    expect(collapsed[1]).toBe(source[3]);
    expect(collapseIssuePartitions(collapsed)).toBe(collapsed);
    expect(source[1].text).toBe("【设备】需要手册");

    const edited = writeIssuePartitionBody(collapsed, "设备", "【设备】只改这一条\n第二行");
    expect(edited.map((item) => item.id)).toEqual(["i1", "i4"]);
    expect(edited[0].text).toBe("【设备】只改这一条\n第二行");
    expect(edited[1]).toBe(collapsed[1]);
    expect(writeIssuePartitionBody(edited, "设备", edited[0].text)).toBe(edited);

    const plans = [
      { id: "n1", projectName: "形态学", items: ["【形态学】压测"], owner: "王五" },
      { id: "n2", projectName: "形态学", items: ["【形态学】补测"] },
      { id: "n3", projectName: "其他计划", items: ["回归"] },
      { id: "n4", projectName: "带入", items: [""] },
    ];
    const planCollapsed = collapseNextWeekPartitions(plans);
    expect(planCollapsed.map((row) => row.id)).toEqual(["n1", "n3", "n4"]);
    expect(planCollapsed[0]).toMatchObject({
      projectName: "形态学",
      items: ["【形态学】压测", "【形态学】补测"],
    });
    expect(planCollapsed[0].owner).toBeUndefined();
    expect(planCollapsed[1]).toBe(plans[2]);
    expect(planCollapsed[2]).toBe(plans[3]);
    expect(collapseNextWeekPartitions(planCollapsed)).toBe(planCollapsed);

    const planEdited = writeNextWeekPartitionBody(planCollapsed, "形态学", "【形态学】压测\n只改这一条");
    expect(planEdited.map((row) => row.id)).toEqual(["n1", "n3", "n4"]);
    expect(planEdited[0]).toMatchObject({ projectName: "形态学", items: ["【形态学】压测", "只改这一条"] });
    expect(planEdited[1]).toBe(planCollapsed[1]);
    expect(planEdited[2]).toBe(planCollapsed[2]);
  });
});
