import { afterEach, describe, expect, it, vi } from "vitest";
import {
  importYunxiaoWorkItems,
  listYunxiaoWorkItems,
  uploadIngestFile,
  yunxiaoErrorMessage,
} from "./api";

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

  it("omits reportPartial when not provided", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ itemIds: ["a"] });
      return jsonResponse(201, { id: "rep-2" });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await importYunxiaoWorkItems(["a"]);
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
