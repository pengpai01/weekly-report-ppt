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

describe("item scopes", () => {
  it("writes only that project's bullets", () => {
    const current = zones();
    current.projects.push({ id: "p2", name: "ERP", bullets: ["对账"], owner: "赵六" });
    const proposed: ZoneSnapshot = {
      ...current,
      projects: [
        { id: "p1", name: "不该改名", bullets: ["完成协议联调"] },
        { id: "p2", name: "不该改 ERP", bullets: ["不该改对账"] },
      ],
      issues: { empty: false, items: [{ id: "i1", title: "不该改", text: "不该改" }] },
      nextWeek: [{ id: "n1", projectName: "不该改", items: ["不该改"] }],
    };
    const next = applyAiText(current, proposed, "project", "p1");
    expect(next.projects[0].name).toBe("设备管理平台联调");
    expect(next.projects[0].bullets).toEqual(["完成协议联调"]);
    expect(next.projects[0].sourceIds).toEqual(["s1"]);
    expect(next.projects[1]).toBe(current.projects[1]);
    expect(next.issues).toBe(current.issues);
    expect(next.nextWeek).toBe(current.nextWeek);
    expect(commitAiPreview(false, current, next, "project", "p1")).toBeNull();
    expect(commitAiPreview(true, current, proposed, "project", "p1")?.projects[1]).toBe(current.projects[1]);
  });

  it("writes only that issue body and only that plan's lines", () => {
    const current = zones();
    current.issues.items.push({ id: "i2", title: "另一条", text: "保持原文" });
    current.nextWeek.push({ id: "n2", projectName: "另一计划", items: ["保持计划"] });
    const issueNext = applyAiText(
      current,
      {
        ...current,
        issues: {
          empty: false,
          items: [
            { id: "i1", title: "不该改标题", text: "压缩后的问题" },
            { id: "i2", title: "不该动", text: "不该动正文" },
          ],
        },
      },
      "issueItem",
      "i1",
    );
    expect(issueNext.issues.items[0].title).toBe("登录失败告警");
    expect(issueNext.issues.items[0].text).toBe("压缩后的问题");
    expect(issueNext.issues.items[1]).toBe(current.issues.items[1]);
    expect(issueNext.projects).toBe(current.projects);
    expect(issueNext.nextWeek).toBe(current.nextWeek);

    const planNext = applyAiText(
      current,
      {
        ...current,
        nextWeek: [
          { id: "n1", projectName: "不该改名", items: ["压缩后的计划"] },
          { id: "n2", projectName: "不该动", items: ["不该动"] },
        ],
      },
      "nextWeekItem",
      "n1",
    );
    expect(planNext.nextWeek[0].projectName).toBe("设备管理平台联调");
    expect(planNext.nextWeek[0].items).toEqual(["压缩后的计划"]);
    expect(planNext.nextWeek[1]).toBe(current.nextWeek[1]);
    expect(planNext.projects).toBe(current.projects);
    expect(planNext.issues).toBe(current.issues);
  });

  it("writes only partition bodies and leaves projects and names alone", () => {
    const current = zones();
    current.issues.items.push({ id: "i2", title: "另一条", text: "【设备】另一条问题" });
    current.nextWeek.push({ id: "n2", projectName: "其他", items: ["保持计划"] });
    const projects = current.projects;
    const issueNext = applyAiText(
      current,
      {
        projects: [{ id: "p1", name: "不该写项目", bullets: ["不该写"] }],
        issues: {
          empty: false,
          items: [
            { id: "i1", title: "不该改标题", text: "压缩后的问题" },
            { id: "i2", title: "不该动标题", text: "【设备】压缩后" },
          ],
        },
        nextWeek: [{ id: "n1", projectName: "不该改", items: ["不该改计划"] }],
      },
      "issuePartition",
    );
    expect(issueNext.projects).toBe(projects);
    expect(issueNext.nextWeek).toBe(current.nextWeek);
    expect(issueNext.issues.items[0].title).toBe("登录失败告警");
    expect(issueNext.issues.items[0].text).toBe("压缩后的问题");
    expect(issueNext.issues.items[1].text).toBe("【设备】压缩后");
    expect(commitAiPreview(false, current, issueNext, "issuePartition")).toBeNull();

    const planNext = applyAiText(
      current,
      {
        ...current,
        projects: [{ id: "p9", name: "不该出现", bullets: ["不该"] }],
        nextWeek: [
          { id: "n1", projectName: "不该改名", items: ["压缩后的计划"] },
          { id: "n2", projectName: "不该动", items: ["不该动"] },
        ],
      },
      "nextWeekPartition",
    );
    expect(planNext.projects).toBe(projects);
    expect(planNext.issues).toBe(current.issues);
    expect(planNext.nextWeek[0].projectName).toBe("设备管理平台联调");
    expect(planNext.nextWeek[0].items).toEqual(["压缩后的计划"]);
    expect(planNext.nextWeek[1].projectName).toBe("其他");
    expect(planNext.nextWeek[1].items).toEqual(["不该动"]);
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

  it("posts scope=project and item scopes without an api key", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ scope: "project", materials: zones() }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    await requestAiSummary(zones(), "project", { projectId: "p1" });
    await requestAiSummary(zones(), "issueItem", { itemId: "i1" });
    await requestAiSummary(zones(), "nextWeekItem", { itemId: "n1" });
    await requestAiSummary(zones(), "issuePartition");
    await requestAiSummary(zones(), "nextWeekPartition");
    expect(bodies[0]).toMatchObject({ scope: "project", projectId: "p1" });
    expect(bodies[1]).toMatchObject({ scope: "issueItem", itemId: "i1" });
    expect(bodies[2]).toMatchObject({ scope: "nextWeekItem", itemId: "n1" });
    expect(bodies[3]).toEqual({ scope: "issuePartition", materials: zones() });
    expect(bodies[4]).toEqual({ scope: "nextWeekPartition", materials: zones() });
    expect(JSON.stringify(bodies)).not.toContain("apiKey");
    expect(JSON.stringify(bodies)).not.toContain("VITE_");
    vi.unstubAllGlobals();
  });
});
