import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMPTY_SELECTION } from "../lib/zoneMerge";
import { applyProjectDelete, AutoMergeToggle, projectDeleteConfirmCopy, ZoneMergePanel } from "./ZoneMergePanel";

describe("shared merge preview", () => {
  it("renders the three zones and merge actions", () => {
    const html = renderToStaticMarkup(
      <ZoneMergePanel
        value={{
          projects: [{ id: "p1", name: "设备管理", bullets: ["联调"] }],
          issues: { empty: false, items: [{ id: "i1", text: "登录失败" }] },
          nextWeek: [{ id: "n1", projectName: "设备管理", items: ["压测"] }],
        }}
        onChange={() => undefined}
      />,
    );
    expect(html).toContain("重要事项");
    expect(html).toContain("存在问题与建议");
    expect(html).toContain("下周工作计划");
    expect(html).toContain(">合并<");
    expect(html).not.toContain("合并所选");
    expect(html).toContain("撤销本次合并");
    expect(html).toContain("主项");
    expect(html).toContain("设备管理");
    expect(html).toContain("1 条");
    expect(html).toContain("展开");
    expect(html).not.toContain("联调");
    expect(html).not.toContain("进展要点");
    expect(html).toContain("上移");
    expect(html).toContain("下移");
    expect(html).toContain("登录失败");
    expect(html).toContain('disabled=""');
  });

  it("starts every project block collapsed with its name and item count", () => {
    const html = renderToStaticMarkup(
      <ZoneMergePanel
        value={{
          projects: [
            { id: "p1", name: "设备管理", bullets: ["联调", "上线"] },
            { id: "p2", name: "", bullets: ["", "待填"] },
          ],
          issues: { empty: true, items: [] },
          nextWeek: [],
        }}
        onChange={() => undefined}
      />,
    );
    expect(html).toContain("设备管理");
    expect(html).toContain("未命名项目");
    expect(html).toContain("2 条");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("联调");
    expect(html).not.toContain("待填");
    expect(html).toContain("选择重要事项 设备管理");
    expect(html).toContain("上移");
    expect(html).toContain("下移");
    expect(html).toContain("⋯");
    expect(html).toContain("删除项目");
    expect(html).toContain("更多 设备管理");
    expect(html).not.toContain("btn-danger");
    expect(html).not.toContain(">删除<");
    expect(html).not.toContain("删除要点");
  });

  it("keeps an empty project list on 添加项目 without a shell card", () => {
    const html = renderToStaticMarkup(
      <ZoneMergePanel
        value={{ projects: [], issues: { empty: true, items: [] }, nextWeek: [] }}
        onChange={() => undefined}
      />,
    );
    expect(html).toContain("添加项目");
    expect(html).toContain("暂无重要事项");
    expect(html).not.toContain("未命名项目");
    expect(html).not.toContain("删除项目");
    expect(html).not.toContain('placeholder="项目名称 *"');
  });

  it("describes child deletion and merge-bar undo, and drops only that project", () => {
    expect(projectDeleteConfirmCopy(" 设备管理 ")).toContain("删除项目「设备管理」");
    expect(projectDeleteConfirmCopy(" 设备管理 ")).toContain("同时删除其下全部要点条目");
    expect(projectDeleteConfirmCopy("")).toContain("未命名项目");
    expect(projectDeleteConfirmCopy("设备管理")).toContain("撤销本次合并");
    expect(projectDeleteConfirmCopy("设备管理")).toContain("整个项目及其全部条目");

    const value = {
      projects: [
        { id: "p1", name: "设备管理", bullets: ["联调", "上线"], status: "in_progress" as const },
        { id: "p2", name: "ERP", bullets: ["对账"] },
      ],
      issues: { empty: false, items: [{ id: "i1", text: "登录失败" }] },
      nextWeek: [{ id: "n1", projectName: "设备管理", items: ["压测"] }],
    };
    const open = new Set(["p1", "p2"]);
    const next = applyProjectDelete(
      value,
      { zone: "projects", ids: ["p1", "p2"], primaryId: "p1" },
      open,
      "p1",
    );
    expect(open.has("p1")).toBe(true);
    expect(next.value.projects).toEqual([value.projects[1]]);
    expect(next.value.issues).toBe(value.issues);
    expect(next.value.nextWeek).toBe(value.nextWeek);
    expect(next.selection).toEqual({ zone: "projects", ids: ["p2"], primaryId: "p2" });
    expect([...next.openProjectIds]).toEqual(["p2"]);

    const emptied = applyProjectDelete(
      { ...value, projects: [value.projects[0]] },
      { zone: "projects", ids: ["p1"], primaryId: "p1" },
      new Set(["p1"]),
      "p1",
    );
    expect(emptied.value.projects).toEqual([]);
    expect(emptied.selection).toEqual(EMPTY_SELECTION);
    expect(emptied.openProjectIds.size).toBe(0);

    const otherZone = applyProjectDelete(
      value,
      { zone: "issues", ids: ["i1"], primaryId: "i1" },
      new Set(),
      "p2",
    );
    expect(otherZone.selection).toEqual({ zone: "issues", ids: ["i1"], primaryId: "i1" });
    expect(otherZone.value.projects.map((item) => item.id)).toEqual(["p1"]);
  });

  it("renders the module auto-merge toggle checked by default at the call site", () => {
    const html = renderToStaticMarkup(<AutoMergeToggle checked onChange={() => undefined} />);
    expect(html).toContain("按模块自动归并");
    expect(html).toContain("入库前关闭可重新预览；确认入库后不回退");
    expect(html).toContain('checked=""');
  });
});
