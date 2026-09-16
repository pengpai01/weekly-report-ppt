import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createMemoryReportStore } from "./store.js";
import { routeApi } from "./http.js";
import {
  YUNXIAO_OPENAPI_BASE,
  YUNXIAO_PATHS,
  classifyYunxiaoItem,
  createMemoryYunxiaoItemStore,
  mapYunxiaoItemsToReport,
  yunxiaoConfigFromEnv,
} from "./yunxiao.js";

const ORG = "62bcfcb73e81781f3ad1d7d7";
const PAT = "test-pat-not-real";
const PROJECT = "DNK-设备软件";
const SPACE = "space-dnk-1";
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
    expect(classifyYunxiaoItem(item({ id: "b", title: "x", category: "Bug", status: "进行中" }))).toBe(
      "issues",
    );
    expect(classifyYunxiaoItem(item({ id: "k", title: "x", category: "Req", status: "阻塞" }))).toBe(
      "issues",
    );
    expect(classifyYunxiaoItem(item({ id: "t", title: "x", category: "Task", status: "待处理" }))).toBe(
      "nextWeek",
    );
    expect(classifyYunxiaoItem(item({ id: "c", title: "x", category: "Req", status: "已取消" }))).toBe(
      "skip",
    );

    const mapped = mapYunxiaoItemsToReport([
      item({ id: "bug1", title: "登录失败", category: "Bug", status: "待处理" }),
      item({ id: "blk", title: "供应链卡住", category: "Req", status: "已阻塞", module: "ERP" }),
      item({ id: "plan", title: "下周联调", category: "Task", status: "待处理", module: "设备管理" }),
      item({ id: "skip", title: "作废需求", category: "Req", status: "已取消" }),
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
  });
});

const servers: import("node:http").Server[] = [];

type MockWorkitem = {
  identifier: string;
  subject: string;
  categoryIdentifier: string;
  status: string;
  statusStageIdentifier?: string;
  assignedTo?: string;
  gmtModified: number;
  sprintIdentifier?: string;
  spaceName?: string;
  module?: string;
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
    Req: [
      {
        identifier: "req-progress",
        subject: "设备协议联调",
        categoryIdentifier: "Req",
        status: "进行中",
        statusStageIdentifier: "2",
        assignedTo: "user-1",
        gmtModified: daysAgo(40),
        sprintIdentifier: SPRINT_DOING,
        module: "设备管理",
      },
      {
        identifier: "req-old",
        subject: "过期需求",
        categoryIdentifier: "Req",
        status: "待处理",
        gmtModified: daysAgo(40),
        sprintIdentifier: "sprint-old",
        module: "设备管理",
      },
    ],
    Task: [
      {
        identifier: "task-done",
        subject: "提测固件",
        categoryIdentifier: "Task",
        status: "已完成",
        statusStageIdentifier: "3",
        gmtModified: daysAgo(2),
        module: "设备管理",
      },
      {
        identifier: "task-plan",
        subject: "下周压测",
        categoryIdentifier: "Task",
        status: "待处理",
        gmtModified: daysAgo(1),
        module: "设备管理",
      },
    ],
    Bug: [
      {
        identifier: "bug-1",
        subject: "登录失败",
        categoryIdentifier: "Bug",
        status: "待处理",
        gmtModified: daysAgo(3),
        module: "设备管理",
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
      expect(url.searchParams.get("category")).toBe("Project");
      return jsonResponse({
        success: true,
        nextToken: "",
        projects: [
          { identifier: SPACE, name: PROJECT, categoryIdentifier: "Project" },
        ],
      });
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
      const token = url.searchParams.get("nextToken");
      const list = byCategory[category] || [];
      if (category === "Req" && !token) {
        return jsonResponse({
          success: true,
          nextToken: "page-2",
          workitems: list.slice(0, 1),
        });
      }
      if (category === "Req" && token === "page-2") {
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
          identifier: "missing-refetch",
          subject: "补拉工作项",
          categoryIdentifier: "Req",
          status: "进行中",
          gmtModified: nowMs,
          module: "补拉模块",
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

  it("GETs workitems via official ListProjects/ListWorkitems paths and Bearer PAT", async () => {
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
    expect(ids).toEqual(expect.arrayContaining(["req-progress", "task-done", "task-plan", "bug-1"]));
    expect(ids).not.toContain("req-old");
    const progress = body.items.find((row: { id: string }) => row.id === "req-progress");
    expect(progress).toMatchObject({
      title: "设备协议联调",
      category: "Req",
      status: "进行中",
      module: "设备管理",
      sprint: "当前迭代",
    });

    expect(calls.some((c) => c.authorization === `Bearer ${PAT}`)).toBe(true);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(
      expect.arrayContaining([
        YUNXIAO_PATHS.listProjects(ORG),
        YUNXIAO_PATHS.listWorkitems(ORG),
        YUNXIAO_PATHS.listSprints(ORG),
      ]),
    );
    expect(calls.map((c) => new URL(c.url).origin).every((origin) => origin === YUNXIAO_OPENAPI_BASE)).toBe(
      true,
    );

    const cached = await itemsStore.getMany(["req-progress"]);
    expect(cached[0]?.title).toBe("设备协议联调");
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
