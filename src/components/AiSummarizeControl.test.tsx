import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiSummarizeControl } from "./AiSummarizeControl";

describe("AiSummarizeControl", () => {
  it("renders the materials-page entry without a key field", () => {
    let applied = false;
    const html = renderToStaticMarkup(
      <AiSummarizeControl
        value={{
          projects: [{ id: "p1", name: "设备管理", bullets: ["联调"] }],
          issues: { empty: true, items: [] },
          nextWeek: [],
        }}
        onApply={() => {
          applied = true;
        }}
      />,
    );
    expect(html).toContain("一键总结");
    expect(html).toContain("总结范围");
    expect(html).toContain("整页");
    expect(html).toContain("重要事项");
    expect(html).toContain("确认前不会写入草稿");
    expect(html).not.toContain("apiKey");
    expect(html).not.toContain("DEEPSEEK_API_KEY");
    expect(html).not.toContain("确认写入");
    expect(applied).toBe(false);
  });
});
