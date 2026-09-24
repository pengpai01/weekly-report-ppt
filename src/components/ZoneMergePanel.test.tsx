import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AutoMergeToggle, ZoneMergePanel } from "./ZoneMergePanel";

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
  });

  it("renders the module auto-merge toggle checked by default at the call site", () => {
    const html = renderToStaticMarkup(<AutoMergeToggle checked onChange={() => undefined} />);
    expect(html).toContain("按模块自动归并");
    expect(html).toContain("入库前关闭可重新预览；确认入库后不回退");
    expect(html).toContain('checked=""');
  });
});
