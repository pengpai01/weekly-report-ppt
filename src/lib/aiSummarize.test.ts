import { describe, expect, it, vi } from "vitest";
import { aiErrorMessage, requestAiSummary } from "./api";
import {
  AI_BULLET_MAX,
  AI_PROGRESS_BULLETS_MAX,
  AI_TITLE_MAX,
  applyAiText,
  buildAiDiff,
  commitAiPreview,
} from "./aiSummarize";
import type { ZoneSnapshot } from "./zoneMerge";

function zones(): ZoneSnapshot {
  return {
    projects: [
      {
        id: "p1",
        name: "设备管理平台联调",
        bullets: ["甲", "乙", "丙", "丁", "戊", "己"].map((mark) => mark.repeat(10)),
        owner: "张三",
        sourceIds: ["s1"],
      },
    ],
    issues: {
      empty: false,
      items: [{ id: "i1", title: "登录失败告警", text: "账号锁定策略过严", owner: "李四" }],
    },
    nextWeek: [{ id: "n1", projectName: "设备管理平台联调", items: ["补充监控"], owner: "王五" }],
  };
}

describe("applyAiText", () => {
  it("clips titles and progress bullets and leaves other zones alone", () => {
    const current = zones();
    const proposed: ZoneSnapshot = {
      projects: [
        {
          id: "p1",
          name: "名".repeat(30),
          bullets: Array.from({ length: 8 }, () => "要".repeat(70)),
        },
      ],
      issues: {
        empty: false,
        items: [{ id: "i1", title: "不该改问题", text: "不该改正文" }],
      },
      nextWeek: [{ id: "n1", projectName: "不该改计划", items: ["不该改"] }],
    };
    const next = applyAiText(current, proposed, "projects");
    expect(Array.from(next.projects[0].name)).toHaveLength(AI_TITLE_MAX);
    expect(next.projects[0].bullets).toHaveLength(AI_PROGRESS_BULLETS_MAX);
    expect(next.projects[0].bullets.every((line) => Array.from(line).length === AI_BULLET_MAX)).toBe(true);
    expect(next.projects[0].owner).toBeUndefined();
    expect(next.projects[0].sourceIds).toEqual(["s1"]);
    expect(next.issues).toBe(current.issues);
    expect(next.nextWeek).toBe(current.nextWeek);
    expect(current.projects[0].owner).toBe("张三");
    expect(current.projects[0].bullets).toHaveLength(6);
  });

  it("does not invent bullets when the proposal is empty", () => {
    const current = zones();
    const next = applyAiText(
      current,
      {
        ...current,
        projects: [{ ...current.projects[0], bullets: [] }],
      },
      "page",
    );
    expect(next.projects[0].bullets).toEqual(current.projects[0].bullets);
  });
});

describe("commitAiPreview", () => {
  it("returns null for cancel and for an unchanged preview", () => {
    const current = zones();
    current.projects[0] = {
      ...current.projects[0],
      bullets: current.projects[0].bullets.slice(0, 3),
    };
    expect(commitAiPreview(false, current, current, "page")).toBeNull();
    expect(commitAiPreview(true, current, null, "page")).toBeNull();
    expect(commitAiPreview(true, current, structuredClone(current), "page")).toBeNull();
  });

  it("returns the rewritten snapshot only after confirm", () => {
    const current = zones();
    const preview: ZoneSnapshot = {
      ...current,
      projects: [{ ...current.projects[0], name: "设备联调", bullets: ["完成协议联调"] }],
    };
    const next = commitAiPreview(true, current, preview, "page");
    expect(next?.projects[0].name).toBe("设备联调");
    expect(next?.projects[0].bullets).toEqual(["完成协议联调"]);
    expect(buildAiDiff(current, next!)).toEqual([
      {
        key: "project-p1",
        zone: "重要事项",
        heading: "设备管理平台联调",
        fields: [
          { label: "标题", before: "设备管理平台联调", after: "设备联调" },
          { label: "要点", before: current.projects[0].bullets.join("\n"), after: "完成协议联调" },
        ],
      },
    ]);
  });
});

describe("requestAiSummary", () => {
  it("posts materials only and surfaces ai.not_configured", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/ai/summarize");
      expect(init.method).toBe("POST");
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
      const body = JSON.parse(String(init.body));
      expect(body).toEqual({ scope: "page", materials: zones() });
      expect(body.apiKey).toBeUndefined();
      return new Response(
        JSON.stringify({
          error: "未配置 DEEPSEEK_API_KEY。原文未改动。",
          code: "ai.not_configured",
          status: "ai.not_configured",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const current = zones();
    await expect(requestAiSummary(current, "page")).rejects.toThrow(/原文未改动/);
    try {
      await requestAiSummary(current, "page");
    } catch (err) {
      expect(aiErrorMessage(err)).toContain("DEEPSEEK_API_KEY");
      expect(aiErrorMessage(err)).toContain("原文未改动");
    }
    expect(current).toEqual(zones());
    vi.unstubAllGlobals();
  });
});
