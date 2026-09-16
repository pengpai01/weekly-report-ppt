import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createMemoryReportStore } from "./store.js";
import { routeApi } from "./http.js";
import {
  DEFAULT_YUNXIAO_SPACE_ID,
  YUNXIAO_OPENAPI_BASE,
  YUNXIAO_PATHS,
  classifyYunxiaoItem,
  createMemoryYunxiaoItemStore,
  mapYunxiaoItemsToReport,
  normalizeYunxiaoWorkitem,
  parseModuleFromTitle,
  toPublicYunxiaoItem,
  yunxiaoConfigFromEnv,
} from "./yunxiao.js";

const ORG = "62bcfcb73e81781f3ad1d7d7";
const PAT = "test-pat-not-real";
const PROJECT = "DNK-设备软件";
const SPACE = DEFAULT_YUNXIAO_SPACE_ID;
const SPRINT_DOING = "sprint-doing";
const nowMs = Date.now();
const daysAgo = (days: number) => nowMs - days * 24 * 60 * 60 * 1000;

type YunxiaoItemLike = {
  id: string;
  title: string;
  category: string;
  status: string;
  module?: string | null;
  assignee?: string | null;
  statusStageIdentifier?: string | null;
  updatedAt?: string;
  raw?: { statusStageIdentifier?: string };
};

function item(partial: YunxiaoItemLike) {
  return { updatedAt: new Date().toISOString(), ...partial };
}

describe("parseModuleFromTitle", () => {
  it("uses the first 【…】 and falls back to 其他", () => {
    expect(parseModuleFromTitle("【设备管理】联调")).toBe("设备管理");
    expect(parseModuleFromTitle("前缀【ERP】再【忽略】")).toBe("ERP");
    expect(parseModuleFromTitle("【 形态学鉴定APP 】标注")).toBe("形态学鉴定APP");
    expect(parseModuleFromTitle("【】空括号")).toBe("其他");
    expect(parseModuleFromTitle("联调设备协议")).toBe("其他");
    expect(parseModuleFromTitle("")).toBe("其他");
    expect(parseModuleFromTitle(null)).toBe("其他");
  });
});

describe("yunxiao mapping", () => {
  it("groups in-progress/done items into projects by the first 【module】", () => {
    const mapped = mapYunxiaoItemsToReport([
      item({
        id: "1",
        title: "【设备管理】联调设备协议",
        category: "任务",
        status: "进行中",
        assignee: "张三",
        statusStageIdentifier: "2",
      }),
      item({
        id: "2",
        title: "【设备管理】提测固件",
        category: "任务",
        status: "已完成",
        statusStageIdentifier: "3",
      }),
      item({
        id: "3",
        title: "【形态学鉴定APP】形态学标注",
        category: "任务",
        status: "已完成",
      }),
    ]);
    expect(mapped.projects).toHaveLength(2);
    const device = mapped.projects.find((p) => p.name === "设备管理");
    const app = mapped.projects.find((p) => p.name === "形态学鉴定APP");
    expect(device).toBeTruthy();
    expect(app).toBeTruthy();
    expect(device?.bullets).toEqual([
      "[进行中·张三] 【设备管理】联调设备协议",
      "[已完成] 【设备管理】提测固件",
    ]);
    expect(device?.status).toBe("in_progress");
    expect(app?.bullets).toEqual(["[已完成] 【形态学鉴定APP】形态学标注"]);
    expect(app?.status).toBe("launched");
    expect(mapped.issues.empty).toBe(true);
    expect(mapped.nextWeek).toEqual([]);
  });

  it("merges the same 【module】 into one projects entry", () => {
    const mapped = mapYunxiaoItemsToReport([
      item({ id: "1", title: "【ERP】接口联调", category: "任务", status: "进行中" }),
      item({ id: "2", title: "前缀【ERP】报表上线", category: "任务", status: "已完成" }),
    ]);
    expect(mapped.projects).toHaveLength(1);
    expect(mapped.projects[0].name).toBe("ERP");
    expect(mapped.projects[0].bullets).toHaveLength(2);
  });

  it("puts titles without 【】 into 其他", () => {
    const mapped = mapYunxiaoItemsToReport([
      item({ id: "1", title: "联调设备协议", category: "任务", status: "进行中", module: "设备管理" }),
    ]);
    expect(mapped.projects).toHaveLength(1);
    expect(mapped.projects[0].name).toBe("其他");
    expect(mapped.projects[0].bullets).toEqual(["[进行中] 联调设备协议"]);
  });

  it("keeps issues and nextWeek flat (not grouped by module)", () => {
    expect(classifyYunxiaoItem(item({ id: "b", title: "x", category: "缺陷", status: "进行中" }))).toBe(
      "issues",
    );
    expect(classifyYunxiaoItem(item({ id: "k", title: "x", category: "任务", status: "阻塞" }))).toBe(
      "issues",
    );
    expect(classifyYunxiaoItem(item({ id: "t", title: "x", category: "任务", status: "待处理" }))).toBe(
      "nextWeek",
    );
    expect(classifyYunxiaoItem(item({ id: "c", title: "x", category: "任务", status: "已取消" }))).toBe(
      "skip",
    );

    const mapped = mapYunxiaoItemsToReport([
      item({ id: "bug1", title: "【登录】登录失败", category: "缺陷", status: "待处理" }),
      item({ id: "blk", title: "【ERP】供应链卡住", category: "任务", status: "已阻塞" }),
      item({ id: "plan1", title: "【设备管理】下周联调", category: "任务", status: "待处理" }),
      item({ id: "plan2", title: "【形态学】下周标注", category: "任务", status: "待处理" }),
      item({ id: "skip", title: "作废需求", category: "任务", status: "已取消" }),
    ]);
    expect(mapped.issues.empty).toBe(false);
    expect(mapped.issues.items.map((i: { text: string }) => i.text)).toEqual([
      "【登录】登录失败",
      "【ERP】供应链卡住",
    ]);
    expect(mapped.nextWeek.map((row) => row.projectName)).toEqual(["", ""]);
    expect(mapped.nextWeek.map((row) => row.items)).toEqual([
      ["【设备管理】下周联调"],
      ["【形态学】下周标注"],
    ]);
    expect(mapped.projects).toEqual([]);
  });

  it("lets reportPartial overlay mapped fields without dropping the mapping defaults", () => {
    const mapped = mapYunxiaoItemsToReport(
      [item({ id: "1", title: "【设备】联调", category: "任务", status: "进行中" })],
      { title: "研发周报", department: "软件研发", templateType: "weekly" },
    );
    expect(mapped.title).toBe("研发周报");
    expect(mapped.department).toBe("软件研发");
    expect(mapped.projects[0].name).toBe("设备");
    expect(mapped.projects[0].bullets).toEqual(["[进行中] 【设备】联调"]);
  });
});

describe("normalizeYunxiaoWorkitem (live probe fields)", () => {
  it("reads nested id/subject/workitemType/status/assignedTo/sprint/module", () => {
    const mapped = normalizeYunxiaoWorkitem({
      id: "wi-1",
      identifier: "should-not-win",
      subject: "联调设备协议",
      workitemType: { name: "任务" },
      status: { name: "进行中", statusStageIdentifier: "2" },
      assignedTo: { name: "张三" },
      gmtModified: 1_700_000_000_000,
      sprint: { id: "sprint-1", name: "Sprint 12" },
      module: { name: "设备管理" },
    });
    expect(toPublicYunxiaoItem(mapped!)).toEqual({
      id: "wi-1",
      title: "联调设备协议",
      category: "任务",
      status: "进行中",
      assignee: "张三",
      updatedAt: new Date(1_700_000_000_000).toISOString(),
      sprint: "Sprint 12",
      module: "设备管理",
    });
  });

  it("omits module when the field is absent (does not fall back to spaceName)", () => {
    const mapped = normalizeYunxiaoWorkitem({
      id: "wi-2",
      subject: "无模块任务",
      workitemType: { name: "任务" },
      status: { name: "待处理" },
      gmtModified: 1_700_000_000_000,
      spaceName: "DNK-设备软件",
    });
    expect(toPublicYunxiaoItem(mapped!).module).toBeUndefined();
  });
});

describe("yunxiaoConfigFromEnv", () => {
  it("returns a clear 500 and never mentions the PAT value", () => {
    try {
      yunxiaoConfigFromEnv({ YUNXIAO_ORG_ID: "org-1", YUNXIAO_PAT: "" });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as Error & { status: number }).status).toBe(500);
      expect((err as Error).message).toMatch(/YUNXIAO_PAT/);
      expect((err as Error).message).not.toContain("super-secret-token");
    }
    try {
      yunxiaoConfigFromEnv({ YUNXIAO_ORG_ID: "", YUNXIAO_PAT: "super-secret-token" });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as Error).message).toMatch(/YUNXIAO_ORG_ID/);
      expect((err as Error).message).not.toContain("super-secret-token");
    }
    const cfg = yunxiaoConfigFromEnv({ YUNXIAO_ORG_ID: "org-1", YUNXIAO_PAT: "token" });
    expect(cfg.spaceId).toBe(DEFAULT_YUNXIAO_SPACE_ID);
  });
});

const servers: import("node:http").Server[] = [];

type MockWorkitem = {
  id: string;
  subject: string;
  workitemType: { name: string };
  status: { name: string; statusStageIdentifier?: string };
  assignedTo?: { name: string };
  gmtModified: number;
  sprint?: { id: string; name: string };
  module?: { name: string };
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createMockFetch(options?: { workitems?: Record<string, MockWorkitem[]>; html?: boolean }) {
  const calls: {
    url: string;
    method: string;
    token: string | null;
    authorization: string | null;
    body: unknown;
  }[] = [];
  const byCategory: Record<string, MockWorkitem[]> = options?.workitems ?? {
    Task: [
      {
        id: "task-progress",
        subject: "【设备管理】设备协议联调",
        workitemType: { name: "任务" },
        status: { name: "进行中", statusStageIdentifier: "2" },
        assignedTo: { name: "张三" },
        gmtModified: daysAgo(40),
        sprint: { id: SPRINT_DOING, name: "当前迭代" },
        module: { name: "设备管理" },
      },
      {
        id: "task-old",
        subject: "过期任务",
        workitemType: { name: "任务" },
        status: { name: "待处理" },
        gmtModified: daysAgo(40),
        sprint: { id: "sprint-old", name: "上个迭代" },
        module: { name: "设备管理" },
      },
      {
        id: "task-done",
        subject: "【设备管理】提测固件",
        workitemType: { name: "任务" },
        status: { name: "已完成", statusStageIdentifier: "3" },
        assignedTo: { name: "李四" },
        gmtModified: daysAgo(2),
        module: { name: "设备管理" },
      },
      {
        id: "task-plan",
        subject: "下周压测",
        workitemType: { name: "任务" },
        status: { name: "待处理" },
        gmtModified: daysAgo(1),
        module: { name: "设备管理" },
      },
    ],
    Bug: [
      {
        id: "bug-1",
        subject: "登录失败",
        workitemType: { name: "缺陷" },
        status: { name: "待处理" },
        gmtModified: daysAgo(3),
        module: { name: "设备管理" },
      },
    ],
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const method = (init?.method || "GET").toUpperCase();
    let parsedBody: unknown = null;
    if (init?.body) {
      parsedBody = JSON.parse(String(init.body));
    }
    calls.push({
      url: url.toString(),
      method,
      token: headers.get("x-yunxiao-token"),
      authorization: headers.get("Authorization"),
      body: parsedBody,
    });
    if (url.origin !== YUNXIAO_OPENAPI_BASE) {
      throw new Error(`unexpected origin ${url.origin}`);
    }
    if (options?.html) {
      return new Response("<!DOCTYPE html><html><body>login</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }

    if (url.pathname.includes("/listWorkitems") || url.pathname.includes("/listProjects")) {
      throw new Error(`legacy path must not be called: ${url.pathname}`);
    }

    if (url.pathname === YUNXIAO_PATHS.listSprints(ORG, SPACE)) {
      expect(method).toBe("GET");
      return jsonResponse([
        { id: SPRINT_DOING, name: "当前迭代", status: "DOING" },
        { id: "sprint-old", name: "上个迭代", status: "DONE" },
      ]);
    }

    if (url.pathname === YUNXIAO_PATHS.searchWorkitems(ORG)) {
      expect(method).toBe("POST");
      expect(headers.get("content-type")).toMatch(/application\/json/i);
      const payload = parsedBody as {
        category?: string;
        spaceId?: string;
        spaceType?: string;
        page?: number;
        perPage?: number;
      };
      expect(payload.spaceId).toBe(SPACE);
      expect(payload.spaceType).toBe("Project");
      expect(payload.category).not.toBe("Req");
      const list = byCategory[payload.category || ""] || [];
      const page = Number(payload.page || 1);
      const perPage = Number(payload.perPage || 200);
      const start = (page - 1) * perPage;
      return jsonResponse(list.slice(start, start + perPage));
    }

    if (url.pathname === YUNXIAO_PATHS.getWorkitem(ORG, "missing-refetch")) {
      return jsonResponse({
        id: "missing-refetch",
        subject: "补拉工作项",
        workitemType: { name: "任务" },
        status: { name: "进行中" },
        gmtModified: nowMs,
        module: { name: "补拉模块" },
      });
    }

    if (url.pathname.startsWith(`/oapi/v1/projex/organizations/${ORG}/workitems/`)) {
      return jsonResponse({ errorMsg: "not found" }, 404);
    }

    throw new Error(`unexpected Yunxiao path ${url.pathname}`);
  };

  return { fetchImpl, calls };
}

async function startApi(deps: Parameters<typeof routeApi>[3]) {
  const store = createMemoryReportStore();
  const server = createServer((req, res) => {
    void routeApi(store, req, res, deps).then((handled) => {
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
        new Promise<void>((resolve, reject) =>
          server.close((err) => (err ? reject(err) : resolve())),
        ),
    ),
  );
});

describe("yunxiao HTTP API (mocked OpenAPI)", () => {
  it("returns 500 with a clear message when Yunxiao env is missing, without calling fetch", async () => {
    let fetched = false;
    const { base } = await startApi({
      yunxiaoEnv: {},
      yunxiaoItems: createMemoryYunxiaoItemStore(),
      yunxiaoFetch: (async () => {
        fetched = true;
        throw new Error("network should not run");
      }) as typeof fetch,
    });
    const res = await fetch(`${base}/api/yunxiao/workitems`);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/YUNXIAO_ORG_ID/);
    expect(body.error).toMatch(/YUNXIAO_PAT/);
    expect(fetched).toBe(false);
  });

  it("GETs Task workitems via SearchWorkitems POST, x-yunxiao-token, and array JSON", async () => {
    const { fetchImpl, calls } = createMockFetch();
    const itemsStore = createMemoryYunxiaoItemStore();
    const { base } = await startApi({
      yunxiaoEnv: { YUNXIAO_ORG_ID: ORG, YUNXIAO_PAT: PAT, YUNXIAO_PROJECT_NAME: PROJECT },
      yunxiaoFetch: fetchImpl,
      yunxiaoItems: itemsStore,
    });

    const res = await fetch(`${base}/api/yunxiao/workitems?updatedWithinDays=14`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.items.map((row: { id: string }) => row.id);
    expect(ids).toEqual(expect.arrayContaining(["task-progress", "task-done", "task-plan", "bug-1"]));
    expect(ids).not.toContain("task-old");
    const progress = body.items.find((row: { id: string }) => row.id === "task-progress");
    expect(progress).toMatchObject({
      title: "【设备管理】设备协议联调",
      category: "任务",
      status: "进行中",
      assignee: "张三",
      module: "设备管理",
      sprint: "当前迭代",
    });

    const searchCalls = calls.filter((c) => c.method === "POST");
    expect(searchCalls.length).toBeGreaterThan(0);
    expect(searchCalls.every((c) => c.token === PAT)).toBe(true);
    expect(searchCalls.every((c) => !c.authorization)).toBe(true);
    const taskSearch = searchCalls.find((c) => (c.body as { category?: string }).category === "Task");
    expect(taskSearch?.body).toMatchObject({
      category: "Task",
      spaceId: SPACE,
      spaceType: "Project",
      page: 1,
      perPage: 200,
      orderBy: "gmtModified",
      sort: "desc",
    });
    expect(searchCalls.map((c) => new URL(c.url).pathname)).toEqual(
      expect.arrayContaining([YUNXIAO_PATHS.searchWorkitems(ORG)]),
    );
    expect(searchCalls.map((c) => (c.body as { category?: string }).category).sort()).toEqual(
      ["Bug", "Task"].sort(),
    );
    expect(calls.map((c) => new URL(c.url).pathname)).not.toContain(`/organization/${ORG}/listWorkitems`);

    const cached = await itemsStore.getMany(["task-progress"]);
    expect(cached[0]?.title).toBe("【设备管理】设备协议联调");
    expect(cached[0]?.assignee).toBe("张三");
  });

  it("returns 502 when Yunxiao answers with an HTML login page instead of JSON", async () => {
    const { fetchImpl } = createMockFetch({ html: true });
    const { base } = await startApi({
      yunxiaoEnv: { YUNXIAO_ORG_ID: ORG, YUNXIAO_PAT: PAT },
      yunxiaoFetch: fetchImpl,
      yunxiaoItems: createMemoryYunxiaoItemStore(),
    });
    const res = await fetch(`${base}/api/yunxiao/workitems`);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/HTML/i);
    expect(body.items).toBeUndefined();
  });

  it("POSTs import from cache into /api/reports create path", async () => {
    const { fetchImpl } = createMockFetch();
    const itemsStore = createMemoryYunxiaoItemStore();
    const { base, store } = await startApi({
      yunxiaoEnv: { YUNXIAO_ORG_ID: ORG, YUNXIAO_PAT: PAT },
      yunxiaoFetch: fetchImpl,
      yunxiaoItems: itemsStore,
    });

    const listed = await (await fetch(`${base}/api/yunxiao/workitems`)).json();
    const itemIds = listed.items.map((row: { id: string }) => row.id);
    const importedRes = await fetch(`${base}/api/yunxiao/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemIds,
        reportPartial: { title: "云效导入周报", department: "软件研发" },
      }),
    });
    expect(importedRes.status).toBe(201);
    const report = await importedRes.json();
    expect(report.title).toBe("云效导入周报");
    expect(report.department).toBe("软件研发");
    expect(report.status).toBe("draft");
    expect(report.projects.map((p: { name: string }) => p.name)).toEqual(["设备管理"]);
    expect(report.projects[0].bullets).toEqual([
      "[进行中·张三] 【设备管理】设备协议联调",
      "[已完成·李四] 【设备管理】提测固件",
    ]);
    expect(report.issues.empty).toBe(false);
    expect(report.issues.items.map((i: { text: string }) => i.text)).toEqual(["登录失败"]);
    expect(report.nextWeek).toHaveLength(1);
    expect(report.nextWeek[0].projectName).toBe("");
    expect(report.nextWeek[0].items).toEqual(["下周压测"]);

    const fromStore = await store.get(report.id);
    expect(fromStore?.title).toBe("云效导入周报");
    const detail = await fetch(`${base}/api/reports/${report.id}`);
    expect(detail.status).toBe(200);
    expect((await detail.json()).id).toBe(report.id);
  });

  it("refetches a missing cache id via GetWorkItemInfo and does not write back to Yunxiao", async () => {
    const { fetchImpl, calls } = createMockFetch();
    const itemsStore = createMemoryYunxiaoItemStore();
    const { base } = await startApi({
      yunxiaoEnv: { YUNXIAO_ORG_ID: ORG, YUNXIAO_PAT: PAT },
      yunxiaoFetch: fetchImpl,
      yunxiaoItems: itemsStore,
    });

    const importedRes = await fetch(`${base}/api/yunxiao/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemIds: ["missing-refetch"] }),
    });
    expect(importedRes.status).toBe(201);
    const report = await importedRes.json();
    expect(report.projects[0].name).toBe("其他");
    expect(report.projects[0].bullets).toEqual(["[进行中] 补拉工作项"]);
    expect(calls.some((c) => c.method === "GET")).toBe(true);
    expect(calls.every((c) => c.method === "GET" || c.method === "POST")).toBe(true);
    expect(calls.map((c) => new URL(c.url).pathname)).toContain(
      YUNXIAO_PATHS.getWorkitem(ORG, "missing-refetch"),
    );
    expect(calls.every((c) => c.method !== "PUT" && c.method !== "PATCH" && c.method !== "DELETE")).toBe(
      true,
    );
  });
});
