import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelIngestPreview,
  confirmImportFields,
  confirmIngestPreview,
  importYunxiaoWorkItems,
  ingestErrorMessage,
  ingestRowError,
  listYunxiaoWorkItems,
  updateReportOnServer,
  uploadIngestFile,
  yunxiaoErrorMessage,
} from "./api";
import type { Report } from "../types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("confirm import contract", () => {
  it("defaults moduleAutoMerge to true and omits materials", () => {
    expect(confirmImportFields()).toEqual({ moduleAutoMerge: true });
    expect(confirmImportFields({})).not.toHaveProperty("materials");
    expect(confirmImportFields({})).not.toHaveProperty("undo");
  });

  it("sends moduleAutoMerge false and materials arrays only when provided", () => {
    const materials = {
      projects: [{ id: "p", name: "设备管理", bullets: ["联调"] }],
      issues: [] as Report["issues"]["items"],
      nextWeek: [],
    };
    expect(confirmImportFields({ moduleAutoMerge: false, materials })).toEqual({
      moduleAutoMerge: false,
      materials,
    });
  });
});

describe("yunxiao API client", () => {
  it("lists work items with updatedWithinDays=14", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/api/yunxiao/workitems?updatedWithinDays=14");
      return jsonResponse(200, {
        items: [
          {
            id: "1",
            title: "设备接入",
            category: "需求",
            status: "进行中",
            module: "平台",
            assignee: "张三",
            updatedAt: "2026-09-11T08:00:00.000Z",
          },
        ],
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await listYunxiaoWorkItems();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("设备接入");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("posts selected ids and optional reportPartial, expecting a report", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/yunxiao/import");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        itemIds: ["a", "b"],
        moduleAutoMerge: true,
        reportPartial: { department: "研发" },
      });
      return jsonResponse(201, {
        id: "rep-1",
        title: "周工作总结",
        templateType: "weekly",
        department: "研发",
        date: "2026-09-16",
        author: "",
        projects: [],
        issues: { empty: true, items: [] },
        nextWeek: [],
        status: "draft",
        createdAt: "2026-09-16T00:00:00.000Z",
        updatedAt: "2026-09-16T00:00:00.000Z",
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const report = await importYunxiaoWorkItems(["a", "b"], { department: "研发" });
    expect(report.id).toBe("rep-1");
    expect(report.title).toBe("周工作总结");
  });

  it("omits reportPartial when not provided and can turn module merge off", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ itemIds: ["a"], moduleAutoMerge: true });
      return jsonResponse(201, { id: "rep-2" });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await importYunxiaoWorkItems(["a"]);

    const off = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ itemIds: ["a"], moduleAutoMerge: false });
      return jsonResponse(201, { id: "rep-3" });
    });
    globalThis.fetch = off as unknown as typeof fetch;
    await importYunxiaoWorkItems(["a"], undefined, { moduleAutoMerge: false });
  });

  it("posts materials arrays and does not send an undo field", async () => {
    const materials = {
      projects: [{ id: "p", name: "设备管理", bullets: ["[进行中·张三] 联调"], sourceIds: ["a"] }],
      issues: [{ id: "i", text: "[待处理] 登录失败", sourceIds: ["b"] }],
      nextWeek: [{ id: "n", projectName: "设备管理", items: ["压测"], sourceIds: ["c"] }],
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        itemIds: ["a"],
        moduleAutoMerge: false,
        materials,
      });
      expect(body).not.toHaveProperty("undo");
      expect(Array.isArray(body.materials.issues)).toBe(true);
      return jsonResponse(201, { id: "rep-materials" });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await importYunxiaoWorkItems(["a"], undefined, { moduleAutoMerge: false, materials });
  });

  it("maps service-down and 4xx failures to readable messages", async () => {
    expect(yunxiaoErrorMessage(new TypeError("Failed to fetch"), "fallback")).toBe(
      "无法连接本机服务，请确认服务已启动后再试。",
    );
    const notFound = new Error("Not found") as Error & { status: number };
    notFound.status = 404;
    expect(yunxiaoErrorMessage(notFound, "fallback")).toBe(
      "云效导入服务暂不可用（接口未就绪或已下线）。",
    );
    const missingItems = new Error("Yunxiao items not found: abc") as Error & { status: number };
    missingItems.status = 404;
    expect(yunxiaoErrorMessage(missingItems, "fallback")).toBe("Yunxiao items not found: abc");
    const forbidden = new Error("nope") as Error & { status: number };
    forbidden.status = 403;
    expect(yunxiaoErrorMessage(forbidden, "fallback")).toBe(
      "云效鉴权失败，请检查本机 .env 中的 YUNXIAO_PAT / YUNXIAO_ORG_ID。",
    );
    const auth502 = new Error("Yunxiao authentication failed. Check YUNXIAO_PAT permissions and YUNXIAO_ORG_ID.") as Error & {
      status: number;
    };
    auth502.status = 502;
    expect(yunxiaoErrorMessage(auth502, "fallback")).toBe(
      "云效鉴权失败，请检查本机 .env 中的 YUNXIAO_PAT / YUNXIAO_ORG_ID。",
    );
    const missingEnv = new Error("Missing Yunxiao config: YUNXIAO_ORG_ID, YUNXIAO_PAT.") as Error & {
      status: number;
    };
    missingEnv.status = 500;
    expect(yunxiaoErrorMessage(missingEnv, "fallback")).toBe(
      "请在项目 .env 填写 YUNXIAO_ORG_ID 和 YUNXIAO_PAT 后重启服务。",
    );
    const bad = new Error("工作项不存在") as Error & { status: number };
    bad.status = 400;
    expect(yunxiaoErrorMessage(bad, "fallback")).toBe("工作项不存在");
  });

  it("uploads ingest files as multipart without forcing JSON content-type", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.body).toBeInstanceOf(FormData);
      const headers = new Headers(init?.headers);
      expect(headers.get("Content-Type")).toBeNull();
      return jsonResponse(200, {
        previewId: "p1",
        rows: [{ row: 2, ok: true, title: "联调", status: "进行中" }],
        summary: { total: 1, ok: 1, error: 0 },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const preview = await uploadIngestFile(new Blob(["事项标题,状态\n联调,进行中\n"], { type: "text/csv" }), "items.csv");
    expect(preview.previewId).toBe("p1");
    expect(preview.summary.ok).toBe(1);
  });

  it("surfaces list HTTP errors from the shared request helper", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(404, { error: "Not found" })) as unknown as typeof fetch;
    await expect(listYunxiaoWorkItems()).rejects.toMatchObject({
      message: "Not found",
      status: 404,
    });
  });
});

describe("ingest API client", () => {
  it("confirms a previewId and optional reportPartial", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/ingest/confirm");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        previewId: "p1",
        moduleAutoMerge: true,
        reportPartial: { department: "研发" },
      });
      return jsonResponse(201, { id: "rep-upload", title: "周工作总结" });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const report = await confirmIngestPreview("p1", { department: "研发" });
    expect(report.id).toBe("rep-upload");
  });

  it("posts moduleAutoMerge and materials on ingest confirm", async () => {
    const materials = {
      projects: [{ id: "p", name: "设备管理", bullets: ["联调"] }],
      issues: [] as Report["issues"]["items"],
      nextWeek: [{ id: "n", projectName: "", items: ["压测"] }],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/ingest/confirm");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        previewId: "p1",
        moduleAutoMerge: true,
        materials,
      });
      expect(body).not.toHaveProperty("undo");
      return jsonResponse(201, { id: "rep-upload" });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await confirmIngestPreview("p1", undefined, { moduleAutoMerge: true, materials });
  });

  it("saves a draft merge with PUT /api/reports/:id", async () => {
    const report = {
      id: "rep-1",
      templateType: "weekly",
      title: "周工作总结",
      department: "研发",
      date: "2026-09-24",
      author: "",
      projects: [{ id: "p", name: "设备管理", bullets: ["[进行中] 联调"], sourceIds: ["a", "b"] }],
      issues: { empty: false, items: [{ id: "i", text: "登录失败" }] },
      nextWeek: [{ id: "n", projectName: "设备管理", items: ["压测"] }],
      slides: [],
      status: "draft",
      createdAt: "2026-09-24T00:00:00.000Z",
      updatedAt: "2026-09-24T00:00:00.000Z",
    } satisfies Report;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/reports/rep-1");
      expect(init?.method).toBe("PUT");
      const body = JSON.parse(String(init?.body));
      expect(body.projects).toEqual(report.projects);
      expect(body.issues).toEqual(report.issues);
      expect(body.nextWeek).toEqual(report.nextWeek);
      expect(body).not.toHaveProperty("undo");
      expect(body).not.toHaveProperty("moduleAutoMerge");
      expect(body).not.toHaveProperty("materials");
      return jsonResponse(200, report);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await updateReportOnServer(report.id, report);
  });

  it("cancels a preview with JSON previewId", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/ingest/cancel");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ previewId: "p1" });
      return new Response(null, { status: 204 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(cancelIngestPreview("p1")).resolves.toBeUndefined();
  });

  it("maps ingest 4xx/5xx failures to Chinese messages", () => {
    expect(ingestErrorMessage(new TypeError("Failed to fetch"), "fallback")).toBe(
      "无法连接本机服务，请确认服务已启动后再试。",
    );
    const wrongType = new Error("File must be .xlsx or .csv") as Error & { status: number };
    wrongType.status = 400;
    expect(ingestErrorMessage(wrongType, "fallback")).toBe("请上传 .xlsx 或 .csv 文件。");
    const missingCols = new Error("Missing required columns: 事项标题, 状态") as Error & { status: number };
    missingCols.status = 400;
    expect(ingestErrorMessage(missingCols, "fallback")).toBe("缺少必填列：事项标题、状态。");
    const expired = new Error("Preview not found") as Error & { status: number };
    expired.status = 404;
    expect(ingestErrorMessage(expired, "fallback")).toBe("预览已过期或不存在，请重新上传。");
    const down = new Error("Not found") as Error & { status: number };
    down.status = 404;
    expect(ingestErrorMessage(down, "fallback")).toBe("表格上传服务暂不可用（接口未就绪或已下线）。");
    const boom = new Error("Server error") as Error & { status: number };
    boom.status = 500;
    expect(ingestErrorMessage(boom, "fallback")).toBe("服务异常（500），请稍后重试。");
    const unknown400 = new Error("something broke") as Error & { status: number };
    unknown400.status = 400;
    expect(ingestErrorMessage(unknown400, "fallback")).toBe("请求失败（400），请检查文件后重试。");
    const alreadyZh = new Error("文件没有数据行。") as Error & { status: number };
    alreadyZh.status = 400;
    expect(ingestErrorMessage(alreadyZh, "fallback")).toBe("文件没有数据行。");
    expect(ingestRowError("事项标题 is required; 状态 is required")).toBe("事项标题为必填；状态为必填");
    expect(ingestRowError()).toBe("未通过");
  });
});
