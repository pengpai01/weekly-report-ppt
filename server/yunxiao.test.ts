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
  statusStageIdentifier?: string | null;
  updatedAt?: string;
  raw?: { statusStageIdentifier?: string };
};

function item(partial: YunxiaoItemLike) {
  return { updatedAt: new Date().toISOString(), ...partial };
}

describe("yunxiao mapping", () => {
  it("sends in-progress and done Req/Task into projects grouped by module", () => {
    const mapped = mapYunxiaoItemsToReport([
      item({
        id: "1",
        title: "联调设备协议",
        category: "Req",
        status: "进行中",
        module: "设备管理",
        statusStageIdentifier: "2",
      }),
      item({
        id: "2",
        title: "提测固件",
        category: "Task",
        status: "已完成",
        module: "设备管理",
        statusStageIdentifier: "3",
      }),
      item({
        id: "3",
        title: "形态学标注",
        category: "Req",
        status: "Done",
        module: "形态学鉴定APP",
      }),
    ]);
    expect(mapped.projects).toHaveLength(2);
    const device = mapped.projects.find((p) => p.name === "设备管理");
    const app = mapped.projects.find((p) => p.name === "形态学鉴定APP");
    expect(device).toBeTruthy();
    expect(app).toBeTruthy();
    expect(device?.bullets).toEqual(["联调设备协议", "提测固件"]);
    expect(device?.status).toBe("in_progress");
    expect(app?.bullets).toEqual(["形态学标注"]);
    expect(app?.status).toBe("launched");
    expect(mapped.issues.empty).toBe(true);
    expect(mapped.nextWeek).toEqual([]);
  });

  it("maps blocked items and Bugs to issues, planned/unfinished to nextWeek", () => {
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
      item({ id: "bug1", title: "登录失败", category: "缺陷", status: "待处理" }),
      item({ id: "blk", title: "供应链卡住", category: "任务", status: "已阻塞", module: "ERP" }),
      item({ id: "plan", title: "下周联调", category: "任务", status: "待处理", module: "设备管理" }),
      item({ id: "skip", title: "作废需求", category: "任务", status: "已取消" }),
    ]);
    expect(mapped.issues.empty).toBe(false);
    expect(mapped.issues.items.map((i: { text: string }) => i.text)).toEqual([
      "登录失败",
      "供应链卡住",
    ]);
    expect(mapped.nextWeek).toEqual([
      expect.objectContaining({ projectName: "设备管理", items: ["下周联调"] }),
    ]);
    expect(mapped.projects).toEqual([]);
  });

  it("lets reportPartial overlay mapped fields without dropping the mapping defaults", () => {
    const mapped = mapYunxiaoItemsToReport(
      [item({ id: "1", title: "联调", category: "Req", status: "进行中", module: "设备" })],
      { title: "研发周报", department: "软件研发", templateType: "weekly" },
    );
    expect(mapped.title).toBe("研发周报");
    expect(mapped.department).toBe("软件研发");
    expect(mapped.projects[0].name).toBe("设备");
    expect(mapped.projects[0].bullets).toEqual(["联调"]);
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

function createMockFetch(options?: { workitems?: Record<string, MockWorkitem[]> }) {
  const calls: { url: string; authorization: string | null; method: string }[] = [];
  const byCategory: Record<string, MockWorkitem[]> = options?.workitems ?? {
    Task: [
      {
        id: "task-progress",
        subject: "设备协议联调",
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
        subject: "提测固件",
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
    const authorization = new Headers(init?.headers).get("Authorization");
    calls.push({ url: url.toString(), authorization, method: init?.method || "GET" });
    if (url.origin !== YUNXIAO_OPENAPI_BASE) {
      throw new Error(`unexpected origin ${url.origin}`);
    }

    if (url.pathname === YUNXIAO_PATHS.listProjects(ORG)) {
      throw new Error("ListProjects should be skipped when YUNXIAO_SPACE_ID is set");
    }

    if (url.pathname === YUNXIAO_PATHS.listSprints(ORG)) {
      expect(url.searchParams.get("spaceType")).toBe("Project");
      expect(url.searchParams.get("spaceIdentifier")).toBe(SPACE);
      return jsonResponse({
        success: true,
        sprints: [
          { identifier: SPRINT_DOING, name: "当前迭代", status: "DOING" },
          { identifier: "sprint-old", name: "上个迭代", status: "DONE" },
        ],
      });
    }

    if (url.pathname === YUNXIAO_PATHS.listWorkitems(ORG)) {
      expect(url.searchParams.get("spaceType")).toBe("Project");
      expect(url.searchParams.get("spaceIdentifier")).toBe(SPACE);
      const category = url.searchParams.get("category") || "";
      expect(["Req"]).not.toContain(category);
      const token = url.searchParams.get("nextToken");
      const list = byCategory[category] || [];
      if (category === "Task" && !token) {
        return jsonResponse({
          success: true,
          nextToken: "page-2",
          workitems: list.slice(0, 1),
        });
      }
      if (category === "Task" && token === "page-2") {
        return jsonResponse({
          success: true,
          nextToken: "",
          workitems: list.slice(1),
        });
      }
      return jsonResponse({ success: true, nextToken: "", workitems: list });
    }

    if (url.pathname === YUNXIAO_PATHS.getWorkitem(ORG, "missing-refetch")) {
      return jsonResponse({
        success: true,
        workitem: {
          id: "missing-refetch",
          subject: "补拉工作项",
          workitemType: { name: "任务" },
          status: { name: "进行中" },
          gmtModified: nowMs,
          module: { name: "补拉模块" },
        },
      });
    }

    if (url.pathname.startsWith(`/organization/${ORG}/workitems/`)) {
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

  it("GETs Task workitems via ListWorkitems with fixed space id and Bearer PAT", async () => {
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
      title: "设备协议联调",
      category: "任务",
      status: "进行中",
      assignee: "张三",
      module: "设备管理",
      sprint: "当前迭代",
    });

    expect(calls.some((c) => c.authorization === `Bearer ${PAT}`)).toBe(true);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(
      expect.arrayContaining([
        YUNXIAO_PATHS.listWorkitems(ORG),
        YUNXIAO_PATHS.listSprints(ORG),
      ]),
    );
    expect(calls.map((c) => new URL(c.url).pathname)).not.toContain(YUNXIAO_PATHS.listProjects(ORG));
    expect(calls.every((c) => new URL(c.url).searchParams.get("category") !== "Req")).toBe(true);
    expect(calls.map((c) => new URL(c.url).origin).every((origin) => origin === YUNXIAO_OPENAPI_BASE)).toBe(
      true,
    );

    const cached = await itemsStore.getMany(["task-progress"]);
    expect(cached[0]?.title).toBe("设备协议联调");
    expect(cached[0]?.assignee).toBe("张三");
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
    expect(report.projects.some((p: { name: string }) => p.name === "设备管理")).toBe(true);
    expect(report.issues.empty).toBe(false);
    expect(report.nextWeek.some((row: { items: string[] }) => row.items.includes("下周压测"))).toBe(
      true,
    );

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
    expect(report.projects[0].name).toBe("补拉模块");
    expect(report.projects[0].bullets).toEqual(["补拉工作项"]);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls.map((c) => new URL(c.url).pathname)).toContain(
      YUNXIAO_PATHS.getWorkitem(ORG, "missing-refetch"),
    );
  });
});
