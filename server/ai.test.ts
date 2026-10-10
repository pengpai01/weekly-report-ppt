import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import {
  AI_BULLET_MAX,
  AI_PROGRESS_BULLETS_MAX,
  AI_TITLE_MAX,
  deepseekConfigured,
  formatAiFailureLog,
  redactAiMessage,
  summarizeMaterials,
} from "./ai.js";
import { routeApi } from "./http.js";
import { createMemoryReportStore } from "./store.js";

const KEY = "sk-test-deepseek-not-real";
const BODY_KEY = "sk-from-browser-must-not-be-used";

const servers: import("node:http").Server[] = [];

function sampleMaterials() {
  return {
    projects: [
      {
        id: "p1",
        name: "设备管理平台联调",
        bullets: ["甲", "乙", "丙", "丁", "戊", "己"].map((mark) => mark.repeat(10)),
        owner: "张三",
        sourceIds: ["s1"],
        status: "in_progress",
      },
    ],
    issues: {
      empty: false,
      items: [
        {
          id: "i1",
          title: "登录失败告警",
          text: "账号锁定策略过严导致值班无法登录后台",
          owner: "李四",
        },
      ],
    },
    nextWeek: [
      {
        id: "n1",
        projectName: "设备管理平台联调",
        items: ["补充监控并回归登录"],
        owner: "王五",
      },
    ],
  };
}

function chatResponse(content: unknown, status = 200) {
  const text =
    typeof content === "string"
      ? content
      : JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] });
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  };
}

function modelRewrite() {
  return {
    projects: [
      {
        id: "p1",
        name: "名".repeat(30),
        bullets: Array.from({ length: 6 }, () => "要".repeat(70)),
      },
    ],
    issues: [{ id: "i1", title: "题".repeat(30), text: "问".repeat(80) }],
    nextWeek: [{ id: "n1", projectName: "计".repeat(30), items: ["下".repeat(80), "多出来的一条"] }],
  };
}

async function startApi(deps: Record<string, unknown> = {}) {
  const store = createMemoryReportStore();
  const server = createServer((req, res) => {
    void routeApi(store, req, res, {
      aiEnv: deps.aiEnv as NodeJS.Dict<string> | undefined,
      aiFetch: deps.aiFetch as typeof fetch | undefined,
      aiTimeoutMs: deps.aiTimeoutMs as number | undefined,
      aiLog:
        (deps.aiLog as ((entry: { code?: string; upstreamStatus?: number }) => void) | undefined) ??
        (() => undefined),
    }).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, store };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    ),
  );
});

describe("deepseek config", () => {
  it("reports configured only from a non-empty server env value", () => {
    expect(deepseekConfigured({})).toBe(false);
    expect(deepseekConfigured({ DEEPSEEK_API_KEY: "  " })).toBe(false);
    expect(deepseekConfigured({ DEEPSEEK_API_KEY: KEY })).toBe(true);
  });

  it("formats failure logs without the key or request text", () => {
    expect(formatAiFailureLog({ code: "ai.not_configured" })).toBe(
      "ai summarize failed code=ai.not_configured upstream=-",
    );
    expect(formatAiFailureLog({ code: KEY, upstreamStatus: KEY as unknown as number })).toBe(
      "ai summarize failed code=ai.upstream upstream=-",
    );
    expect(formatAiFailureLog({ code: "ai.upstream", upstreamStatus: 502 })).not.toContain(KEY);
    expect(redactAiMessage(`failed ${KEY} Bearer ${KEY}`, { DEEPSEEK_API_KEY: KEY })).toBe(
      "failed [redacted] Bearer [redacted]",
    );
  });
});

describe("POST /api/ai/summarize", () => {
  it("returns ai.not_configured and does not call upstream or write the draft", async () => {
    let called = 0;
    const { base, store } = await startApi({
      aiEnv: {},
      aiFetch: async () => {
        called += 1;
        return chatResponse(modelRewrite());
      },
    });
    const created = await store.create({
      title: "周工作总结",
      department: "软件研发",
      templateType: "weekly",
      ...sampleMaterials(),
    });

    const res = await fetch(`${base}/api/ai/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "page", materials: sampleMaterials(), apiKey: BODY_KEY }),
    });
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.code).toBe("ai.not_configured");
    expect(body.status).toBe("ai.not_configured");
    expect(body.error).toContain("DEEPSEEK_API_KEY");
    expect(body.error).toContain("原文未改动");
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(JSON.stringify(body)).not.toContain(BODY_KEY);
    expect(called).toBe(0);
    expect(await store.get(created.id)).toEqual(created);
  });

  it("rewrites within limits, strips echoed keys, and still does not persist", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const { base, store } = await startApi({
      aiEnv: { DEEPSEEK_API_KEY: KEY },
      aiFetch: async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        const echoed = modelRewrite();
        echoed.projects[0].name = `${KEY}${"名".repeat(30)}`;
        return chatResponse(echoed);
      },
    });
    const created = await store.create({
      title: "周工作总结",
      department: "软件研发",
      templateType: "weekly",
      ...sampleMaterials(),
    });
    const original = structuredClone(sampleMaterials());

    const res = await fetch(`${base}/api/ai/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "page", materials: original, apiKey: BODY_KEY }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.scope).toBe("page");
    const project = body.materials.projects[0];
    expect(Array.from(project.name)).toHaveLength(AI_TITLE_MAX);
    expect(project.name).not.toContain(KEY);
    expect(project.bullets).toHaveLength(AI_PROGRESS_BULLETS_MAX);
    expect(project.bullets.every((line: string) => Array.from(line).length <= AI_BULLET_MAX)).toBe(true);
    expect(project.sourceIds).toEqual(["s1"]);
    expect(project.status).toBe("in_progress");
    expect(project.owner).toBeUndefined();
    expect(Array.from(body.materials.issues.items[0].title)).toHaveLength(AI_TITLE_MAX);
    expect(Array.from(body.materials.issues.items[0].text)).toHaveLength(AI_BULLET_MAX);
    expect(body.materials.issues.items[0].owner).toBeUndefined();
    expect(Array.from(body.materials.nextWeek[0].projectName)).toHaveLength(AI_TITLE_MAX);
    expect(body.materials.nextWeek[0].items).toEqual(["下".repeat(AI_BULLET_MAX)]);
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(JSON.stringify(body)).not.toContain(BODY_KEY);
    expect(original).toEqual(sampleMaterials());
    expect(calls).toHaveLength(1);
    expect(String(calls[0].url)).toBe("https://api.deepseek.com/chat/completions");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(String(calls[0].init.body)).not.toContain(BODY_KEY);
    expect(String(calls[0].init.body)).not.toContain(KEY);
    expect(await store.get(created.id)).toEqual(created);
  });

  it("keeps other zones when only one zone is requested", async () => {
    const { base } = await startApi({
      aiEnv: { DEEPSEEK_API_KEY: KEY, DEEPSEEK_API_BASE_URL: "https://api.deepseek.com/v1" },
      aiFetch: async (url: string, init: RequestInit) => {
        expect(String(url)).toBe("https://api.deepseek.com/v1/chat/completions");
        const user = JSON.parse(
          JSON.parse(String(init.body)).messages[1].content,
        ) as { projects?: unknown; issues?: unknown; nextWeek?: unknown };
        expect(user.projects).toBeUndefined();
        expect(user.nextWeek).toBeUndefined();
        expect(user.issues).toEqual([
          { id: "i1", title: "登录失败告警", text: "账号锁定策略过严导致值班无法登录后台" },
        ]);
        return chatResponse({
          projects: [{ id: "p1", name: "不该写上的项目", bullets: ["不该出现"] }],
          issues: [{ id: "i1", title: "登录锁定", text: "值班账号被锁定" }],
        });
      },
    });
    const res = await fetch(`${base}/api/ai/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "issues", materials: sampleMaterials() }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.materials.projects[0].name).toBe("设备管理平台联调");
    expect(body.materials.projects[0].owner).toBe("张三");
    expect(body.materials.nextWeek[0].projectName).toBe("设备管理平台联调");
    expect(body.materials.issues.items[0].title).toBe("登录锁定");
    expect(body.materials.issues.items[0].text).toBe("值班账号被锁定");
  });

  it("leaves the draft unchanged on timeout, rate limit, and empty output", async () => {
    const cases = [
      {
        name: "timeout",
        status: 504,
        code: "ai.timeout",
        fetch: (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            const abort = () => {
              const error = new Error("timeout");
              error.name = "TimeoutError";
              reject(error);
            };
            if (init.signal?.aborted) abort();
            else init.signal?.addEventListener("abort", abort, { once: true });
          }),
        timeoutMs: 20,
      },
      {
        name: "rate limit",
        status: 429,
        code: "ai.rate_limited",
        fetch: async () => chatResponse(KEY, 429),
      },
      {
        name: "empty",
        status: 502,
        code: "ai.empty",
        fetch: async () => chatResponse({ choices: [{ message: { content: "{}" } }] }, 200),
      },
      {
        name: "upstream",
        status: 502,
        code: "ai.upstream",
        fetch: async () => ({ ok: false, status: 500, text: async () => KEY }),
      },
    ] as const;

    for (const item of cases) {
      const logs: unknown[] = [];
      const { base, store } = await startApi({
        aiEnv: { DEEPSEEK_API_KEY: KEY },
        aiFetch: item.fetch,
        aiTimeoutMs: "timeoutMs" in item ? item.timeoutMs : undefined,
        aiLog: (entry: unknown) => logs.push(entry),
      });
      const created = await store.create({
        title: "周工作总结",
        department: "软件研发",
        templateType: "weekly",
        projects: [{ id: "p1", name: "设备管理", bullets: ["联调"] }],
        issues: { empty: true, items: [] },
        nextWeek: [],
      });
      const res = await fetch(`${base}/api/ai/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "projects",
          materials: {
            projects: [{ id: "p1", name: "设备管理", bullets: ["联调"] }],
            issues: { empty: true, items: [] },
            nextWeek: [],
          },
        }),
      });
      const body = await res.json();
      expect(res.status, item.name).toBe(item.status);
      expect(body.code, item.name).toBe(item.code);
      expect(body.status, item.name).toBe(item.code);
      expect(body.error, item.name).toContain("原文未改动");
      expect(JSON.stringify(body), item.name).not.toContain(KEY);
      expect(JSON.stringify(logs), item.name).not.toContain(KEY);
      expect(await store.get(created.id), item.name).toEqual(created);
    }
  });

  it("does not persist when the model omits an item", async () => {
    const input = sampleMaterials();
    await expect(
      summarizeMaterials(
        { scope: "projects", materials: input },
        {
          env: { DEEPSEEK_API_KEY: KEY },
          fetch: async () => chatResponse({ projects: [] }),
        },
      ),
    ).rejects.toMatchObject({ code: "ai.empty", status: 502 });
    expect(input).toEqual(sampleMaterials());
  });
});

describe("scoped project and item summarize", () => {
  const packed = () => ({
    projects: [
      {
        id: "p1",
        name: "不应进模型的标题",
        bullets: ["联调要点需要压缩"],
        owner: "张三",
        status: "in_progress",
        sourceIds: ["s1"],
      },
      { id: "p2", name: "其他项目", bullets: ["其他项目要点不能出现"], owner: "赵六" },
    ],
    issues: {
      empty: false,
      items: [
        { id: "i1", title: "【设备】登录失败", text: "【设备】账号锁定策略过严导致无法登录", owner: "李四" },
        { id: "i2", title: "另一条", text: "另一条问题不能出现" },
      ],
    },
    nextWeek: [
      { id: "n1", projectName: "【形态学】下周", items: ["【形态学】补充监控并回归"], owner: "王五" },
      { id: "n2", projectName: "其他计划", items: ["其他计划不能出现"] },
    ],
  });

  it("rewrites one project's bullets and does not send the rest upstream", async () => {
    let upstream = "";
    const { base, store } = await startApi({
      aiEnv: { DEEPSEEK_API_KEY: KEY },
      aiFetch: async (_url: string, init: RequestInit) => {
        upstream = String(init.body);
        return chatResponse({
          project: { id: "p1", name: `${KEY}改掉的标题`, bullets: [`${KEY}${"要".repeat(80)}`, "第二条", "第三条", "第四条", "第五条", "第六条"] },
          projects: [{ id: "p2", name: "不该写", bullets: ["不该写"] }],
          issues: [{ id: "i1", text: "不该写问题" }],
          nextWeek: [{ id: "n1", items: ["不该写计划"] }],
        });
      },
    });
    const created = await store.create({
      title: "周工作总结",
      department: "软件研发",
      templateType: "weekly",
      ...packed(),
    });
    const original = packed();
    const res = await fetch(`${base}/api/ai/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "project", projectId: "p1", materials: original, apiKey: BODY_KEY }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.scope).toBe("project");
    expect(body.materials.projects[0].name).toBe("不应进模型的标题");
    expect(body.materials.projects[0].bullets).toEqual(["要".repeat(AI_BULLET_MAX)]);
    expect(body.materials.projects[0].status).toBe("in_progress");
    expect(body.materials.projects[0].sourceIds).toEqual(["s1"]);
    expect(body.materials.projects[0].owner).toBeUndefined();
    expect(body.materials.projects[1]).toEqual(original.projects[1]);
    expect(body.materials.issues).toEqual(original.issues);
    expect(body.materials.nextWeek).toEqual(original.nextWeek);
    expect(JSON.stringify(body)).not.toContain(KEY);
    const user = JSON.parse(JSON.parse(upstream).messages[1].content);
    expect(user.project).toEqual({ id: "p1", bullets: ["联调要点需要压缩"] });
    expect(user.projects).toBeUndefined();
    expect(user.issues).toBeUndefined();
    expect(user.nextWeek).toBeUndefined();
    expect(upstream).not.toContain("不应进模型的标题");
    expect(upstream).not.toContain("其他项目要点不能出现");
    expect(upstream).not.toContain("另一条问题不能出现");
    expect(upstream).not.toContain("其他计划不能出现");
    expect(upstream).not.toContain(KEY);
    expect(upstream).not.toContain(BODY_KEY);
    expect(original).toEqual(packed());
    expect(await store.get(created.id)).toEqual(created);
  });

  it("rewrites one issue body and one next-week row without touching projects", async () => {
    const seen: string[] = [];
    const { base } = await startApi({
      aiEnv: { DEEPSEEK_API_KEY: KEY },
      aiFetch: async (_url: string, init: RequestInit) => {
        const user = JSON.parse(JSON.parse(String(init.body)).messages[1].content) as {
          scope?: string;
          issue?: unknown;
          nextWeekItem?: unknown;
          project?: unknown;
        };
        seen.push(JSON.stringify(user));
        if (user.scope === "issueItem") {
          expect(user.project).toBeUndefined();
          expect(user.nextWeekItem).toBeUndefined();
          return chatResponse({
            issue: { id: "i1", title: "不该改标题", text: `${KEY}【设备】账号被锁定` },
          });
        }
        expect(user.scope).toBe("nextWeekItem");
        expect(user.project).toBeUndefined();
        expect(user.issue).toBeUndefined();
        return chatResponse({
          nextWeekItem: { id: "n1", projectName: "不该改名", items: ["【形态学】完成压测", "多出来的一条"] },
        });
      },
    });
    const materials = packed();
    const issueRes = await fetch(`${base}/api/ai/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "issueItem", itemId: "i1", materials }),
    });
    const issueBody = await issueRes.json();
    expect(issueRes.status).toBe(200);
    expect(issueBody.materials.issues.items[0].title).toBe("【设备】登录失败");
    expect(issueBody.materials.issues.items[0].text).toBe("【设备】账号被锁定");
    expect(issueBody.materials.issues.items[0].owner).toBeUndefined();
    expect(issueBody.materials.issues.items[1]).toEqual(materials.issues.items[1]);
    expect(issueBody.materials.projects).toEqual(materials.projects);
    expect(issueBody.materials.nextWeek).toEqual(materials.nextWeek);
    expect(JSON.stringify(issueBody)).not.toContain(KEY);

    const planRes = await fetch(`${base}/api/ai/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "nextWeekItem", itemId: "n1", materials }),
    });
    const planBody = await planRes.json();
    expect(planRes.status).toBe(200);
    expect(planBody.materials.nextWeek[0].projectName).toBe("【形态学】下周");
    expect(planBody.materials.nextWeek[0].items).toEqual(["【形态学】完成压测"]);
    expect(planBody.materials.nextWeek[1]).toEqual(materials.nextWeek[1]);
    expect(planBody.materials.projects[0].bullets).toEqual(["联调要点需要压缩"]);
    expect(planBody.materials.issues.items[0].text).toBe("【设备】账号锁定策略过严导致无法登录");
    expect(seen[0]).not.toContain("其他项目要点不能出现");
    expect(seen[0]).not.toContain("另一条问题不能出现");
    expect(seen[1]).not.toContain("其他计划不能出现");
    expect(seen[1]).not.toContain("联调要点需要压缩");
    expect(materials).toEqual(packed());
  });

  it("returns ai.not_configured for a project scope without calling upstream", async () => {
    let called = 0;
    const { base } = await startApi({
      aiEnv: {},
      aiFetch: async () => {
        called += 1;
        return chatResponse({ project: { id: "p1", bullets: ["不该出现"] } });
      },
    });
    const res = await fetch(`${base}/api/ai/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "project",
        projectId: "p1",
        materials: {
          projects: [{ id: "p1", name: "设备管理", bullets: ["联调"] }],
          issues: { empty: true, items: [] },
          nextWeek: [],
        },
      }),
    });
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.code).toBe("ai.not_configured");
    expect(body.error).toContain("原文未改动");
    expect(called).toBe(0);
  });

  it("rejects a missing target id before calling upstream", async () => {
    let called = 0;
    const { base } = await startApi({
      aiEnv: { DEEPSEEK_API_KEY: KEY },
      aiFetch: async () => {
        called += 1;
        return chatResponse({});
      },
    });
    const materials = {
      projects: [{ id: "p1", name: "设备管理", bullets: ["联调"] }],
      issues: { empty: false, items: [{ id: "i1", text: "问题" }] },
      nextWeek: [{ id: "n1", projectName: "计划", items: ["下周"] }],
    };
    const missingProject = await fetch(`${base}/api/ai/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "project", materials }),
    });
    const missingIssue = await fetch(`${base}/api/ai/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "issueItem", materials }),
    });
    expect(missingProject.status).toBe(400);
    expect((await missingProject.json()).code).toBe("ai.bad_request");
    expect(missingIssue.status).toBe(400);
    expect(called).toBe(0);
  });

  it("rewrites a partition's bodies only and never replaces projects", async () => {
    const seen: string[] = [];
    const { base } = await startApi({
      aiEnv: { DEEPSEEK_API_KEY: KEY },
      aiFetch: async (_url: string, init: RequestInit) => {
        const user = JSON.parse(JSON.parse(String(init.body)).messages[1].content) as {
          scope?: string;
          issues?: unknown;
          nextWeek?: unknown;
          projects?: unknown;
        };
        seen.push(JSON.stringify(user));
        if (user.scope === "issuePartition") {
          expect(user.projects).toBeUndefined();
          expect(user.nextWeek).toBeUndefined();
          return chatResponse({
            issues: [{ id: "i1", title: "不该改标题", text: `${KEY}【设备】账号被锁定` }],
            projects: [{ id: "p1", name: "不该写项目", bullets: ["不该写"] }],
          });
        }
        expect(user.scope).toBe("nextWeekPartition");
        expect(user.projects).toBeUndefined();
        expect(user.issues).toBeUndefined();
        return chatResponse({
          nextWeek: [{ id: "n1", projectName: "不该改名", items: [`${KEY}【形态学】完成压测`, "多出来的一条"] }],
          projects: [{ id: "p1", name: "不该写项目", bullets: ["不该写"] }],
        });
      },
    });
    const issueMaterials = {
      projects: packed().projects,
      issues: { empty: false, items: [packed().issues.items[0]] },
      nextWeek: [],
    };
    const issueRes = await fetch(`${base}/api/ai/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "issuePartition", materials: issueMaterials }),
    });
    const issueBody = await issueRes.json();
    expect(issueRes.status).toBe(200);
    expect(issueBody.scope).toBe("issuePartition");
    expect(issueBody.materials.projects).toEqual(issueMaterials.projects);
    expect(issueBody.materials.issues.items[0].title).toBe("【设备】登录失败");
    expect(issueBody.materials.issues.items[0].text).toBe("【设备】账号被锁定");
    expect(issueBody.materials.nextWeek).toEqual([]);
    expect(JSON.stringify(issueBody)).not.toContain(KEY);

    const planMaterials = {
      projects: packed().projects,
      issues: { empty: true, items: [] },
      nextWeek: [packed().nextWeek[0]],
    };
    const planRes = await fetch(`${base}/api/ai/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "nextWeekPartition", materials: planMaterials }),
    });
    const planBody = await planRes.json();
    expect(planRes.status).toBe(200);
    expect(planBody.materials.nextWeek[0].projectName).toBe("【形态学】下周");
    expect(planBody.materials.nextWeek[0].items).toEqual(["【形态学】完成压测"]);
    expect(planBody.materials.projects).toEqual(planMaterials.projects);
    expect(planBody.materials.issues).toEqual(planMaterials.issues);
    expect(seen[0]).not.toContain("其他项目要点不能出现");
    expect(seen[0]).not.toContain("另一条问题不能出现");
    expect(seen[0]).toContain("issuePartition");
    expect(seen[1]).not.toContain("联调要点需要压缩");
    expect(seen[1]).toContain("nextWeekPartition");
    expect(issueMaterials.projects).toEqual(packed().projects);
  });

  it("returns ai.not_configured for a partition scope without calling upstream", async () => {
    let called = 0;
    const { base } = await startApi({
      aiEnv: {},
      aiFetch: async () => {
        called += 1;
        return chatResponse({ issues: [{ id: "i1", text: "不该出现" }] });
      },
    });
    const res = await fetch(`${base}/api/ai/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "issuePartition",
        materials: {
          projects: [{ id: "p1", name: "设备管理", bullets: ["联调"] }],
          issues: { empty: false, items: [{ id: "i1", text: "【设备】账号锁定" }] },
          nextWeek: [],
        },
      }),
    });
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.code).toBe("ai.not_configured");
    expect(body.error).toContain("原文未改动");
    expect(called).toBe(0);
  });
});

describe("client and server source", () => {
  it("does not put the key on the frontend or in a VITE variable", () => {
    const source = [
      "src/lib/api.ts",
      "src/lib/aiSummarize.ts",
      "src/lib/bracketTag.ts",
      "src/components/AiSummarizeControl.tsx",
      "src/components/ZoneMergePanel.tsx",
      "src/pages/MaterialsPage.tsx",
      "server/ai.js",
      "server/http.js",
      "server/index.js",
    ]
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(source).not.toMatch(/VITE_DEEPSEEK/);
    expect(source).not.toMatch(/import\.meta\.env/);
    expect(source).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(readFileSync("src/pages/MaterialsPage.tsx", "utf8")).not.toContain("一键总结");
    expect(readFileSync("src/pages/MaterialsPage.tsx", "utf8")).not.toContain("总结范围");
    expect(readFileSync("src/components/AiSummarizeControl.tsx", "utf8")).toContain("一键总结");
    expect(readFileSync("src/components/ZoneMergePanel.tsx", "utf8")).toContain("ProjectAiButton");
    expect(readFileSync("src/components/ZoneMergePanel.tsx", "utf8")).toContain("IssueAiButton");
    expect(readFileSync("src/components/ZoneMergePanel.tsx", "utf8")).toContain("NextWeekAiButton");
    expect(readFileSync("src/components/ZoneMergePanel.tsx", "utf8")).not.toContain("移到其他项目");
  });
});
