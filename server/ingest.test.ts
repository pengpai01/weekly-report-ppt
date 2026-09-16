import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import mysql from "mysql2/promise";
import * as XLSX from "xlsx";
import { routeApi } from "./http.js";
import {
  composeFullText,
  createMemoryIngestRawStore,
  createMemoryPreviewStore,
  dedupeIngestRows,
  INGEST_RAW_TABLE,
  mapIngestRowsToReport,
  parseCsv,
  parseIngestSpreadsheet,
  resolveModuleAndTitle,
} from "./ingest.js";
import { mysqlConfigFromEnv } from "./config.js";
import { createMemoryReportStore, createReportStore } from "./store.js";

const CSV_HEADERS = "事项标题,状态,模块,负责人,详情,计划日期,来源ID";

function csvFile(body: string, name = "items.csv") {
  const form = new FormData();
  form.append("file", new Blob([body], { type: "text/csv; charset=utf-8" }), name);
  return form;
}

function xlsxBuffer(rows: unknown[][]) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

function xlsxFile(rows: unknown[][], name = "items.xlsx") {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(xlsxBuffer(rows))], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    name,
  );
  return form;
}

const servers: import("node:http").Server[] = [];

async function startApi() {
  const store = createMemoryReportStore();
  const ingestStore = createMemoryIngestRawStore();
  const previewStore = createMemoryPreviewStore();
  const server = createServer((req, res) => {
    void routeApi(store, req, res, { ingestStore, previewStore }).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, store, ingestStore, previewStore };
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

describe("ingest parse", () => {
  it("parses quoted CSV and requires 事项标题 / 状态", () => {
    const matrix = parseCsv(`${CSV_HEADERS}\n"联调,协议",进行中,设备管理\n`);
    expect(matrix[1][0]).toBe("联调,协议");
    expect(() => parseIngestSpreadsheet(Buffer.from("foo,bar\n1,2\n"), "x.csv")).toThrow(
      /Missing required columns/,
    );
    expect(() => parseIngestSpreadsheet(Buffer.from("x"), "notes.txt")).toThrow(/xlsx or \.csv/i);
  });

  it("keeps invalid rows in preview with ok:false and does not drop them", () => {
    const parsed = parseIngestSpreadsheet(
      Buffer.from(
        `${CSV_HEADERS}\n联调,进行中,设备管理,,细节,,src-1\n,进行中,设备管理\n有标题,\n\n`,
      ),
      "items.csv",
    );
    expect(parsed.summary).toEqual({ total: 3, ok: 1, error: 2 });
    expect(parsed.rows[0]).toMatchObject({
      row: 2,
      ok: true,
      title: "联调",
      status: "进行中",
      module: "设备管理",
      detail: "细节",
      sourceId: "src-1",
    });
    expect(parsed.rows[1].ok).toBe(false);
    expect(parsed.rows[1].error).toMatch(/事项标题/);
    expect(parsed.rows[2].ok).toBe(false);
    expect(parsed.rows[2].error).toMatch(/状态/);
  });

  it("groups 【模块】 titles and defaults empty module to 其他", () => {
    expect(resolveModuleAndTitle("【设备管理】联调", "")).toEqual({
      project: "设备管理",
      title: "联调",
    });
    expect(resolveModuleAndTitle("无模块事项", "")).toEqual({
      project: "其他",
      title: "无模块事项",
    });
    expect(resolveModuleAndTitle("联调", "【形态学】")).toEqual({
      project: "形态学",
      title: "联调",
    });
    expect(resolveModuleAndTitle("联调设备协议", "设备管理")).toEqual({
      project: "设备管理",
      title: "联调设备协议",
    });
    expect(resolveModuleAndTitle("前缀【ERP】报表", "")).toEqual({
      project: "ERP",
      title: "前缀【ERP】报表",
    });
    expect(composeFullText("联调", "细节")).toBe("联调\n细节");
  });
});

describe("ingest confirm mapping", () => {
  it("maps in-progress/done to projects, blocked/Bug to issues, unfinished/planned to nextWeek", () => {
    const parsed = parseIngestSpreadsheet(
      Buffer.from(
        [
          CSV_HEADERS,
          "联调设备协议,进行中,设备管理,张三,与硬件联调,,dev-1",
          "提测固件,已完成,设备管理,,,,dev-2",
          "动态学联调,处理中,动态学app,,,,dyn-1",
          "发布版本,完成,设备管理,,,,dev-3",
          "形态学标注,Done,,,无模块完成,,",
          "登录失败,Bug,设备管理,,,,bug-1",
          "供应链卡住,已阻塞,ERP,,,,blk-1",
          "下周压测,待处理,设备管理,,,,plan-1",
          "未完成文档,未完成,设备管理,,,,plan-2",
          "计划发布,planned,发布,,,,plan-3",
        ].join("\n"),
      ),
      "map.csv",
    );
    const mapped = mapIngestRowsToReport(parsed.rows.filter((row) => row.ok));
    const device = mapped.projects.find((p: { name: string }) => p.name === "设备管理");
    const dyn = mapped.projects.find((p: { name: string }) => p.name === "动态学app");
    const other = mapped.projects.find((p: { name: string }) => p.name === "其他");
    expect(device?.bullets).toEqual([
      "[进行中·张三] 联调设备协议\n与硬件联调",
      "[已完成] 提测固件",
      "[完成] 发布版本",
    ]);
    expect(device?.status).toBe("in_progress");
    expect(dyn?.bullets).toEqual(["[处理中] 动态学联调"]);
    expect(dyn?.status).toBe("in_progress");
    expect(other?.bullets).toEqual(["[Done] 形态学标注\n无模块完成"]);
    expect(mapped.issues.empty).toBe(false);
    expect(mapped.issues.items.map((i: { text: string }) => i.text)).toEqual([
      "登录失败",
      "供应链卡住",
    ]);
    expect(mapped.nextWeek.map((row: { projectName: string }) => row.projectName)).toEqual(["", "", ""]);
    expect(mapped.nextWeek.map((row: { items: string[] }) => row.items)).toEqual([
      ["下周压测"],
      ["未完成文档"],
      ["计划发布"],
    ]);
  });

  it("merges the same module name into one project and dedupes sourceId / full text", () => {
    const parsed = parseIngestSpreadsheet(
      Buffer.from(
        [
          "事项标题,状态,模块,来源ID,详情",
          "【设备管理】联调,进行中,,a1,",
          "提测,已完成,设备管理,a1,",
          "重复正文,进行中,设备管理,,相同",
          "重复正文,进行中,设备管理,,相同",
        ].join("\n"),
      ),
      "dup.csv",
    );
    const unique = dedupeIngestRows(parsed.rows.filter((row) => row.ok));
    expect(unique).toHaveLength(2);
    const mapped = mapIngestRowsToReport(unique);
    expect(mapped.projects).toHaveLength(1);
    expect(mapped.projects[0].name).toBe("设备管理");
    expect(mapped.projects[0].bullets).toEqual(["[进行中] 联调", "[进行中] 重复正文\n相同"]);
  });

  it("merges similar module names into the longer formal name for 处理中/已完成 rows", () => {
    const parsed = parseIngestSpreadsheet(
      Buffer.from(
        [
          "事项标题,状态,模块",
          "协议联调,处理中,设备",
          "提测固件,已完成,设备管理",
          "形态学标注,处理中,形态学",
          "形态学提测,已完成,形态学鉴定APP",
        ].join("\n"),
      ),
      "merge.csv",
    );
    const mapped = mapIngestRowsToReport(parsed.rows.filter((row) => row.ok));
    expect(mapped.projects).toHaveLength(2);
    const device = mapped.projects.find((p: { name: string }) => p.name === "设备管理");
    const app = mapped.projects.find((p: { name: string }) => p.name === "形态学鉴定APP");
    expect(device?.bullets).toEqual(["[处理中] 协议联调", "[已完成] 提测固件"]);
    expect(app?.bullets).toEqual(["[处理中] 形态学标注", "[已完成] 形态学提测"]);
    expect(mapped.projects.map((p: { name: string }) => p.name)).not.toContain("设备");
    expect(mapped.projects.map((p: { name: string }) => p.name)).not.toContain("形态学");
    expect(mapped.nextWeek).toEqual([]);
  });
});

async function uploadAndConfirm(base: string, csvBody: string) {
  const uploadRes = await fetch(`${base}/api/ingest/upload`, {
    method: "POST",
    body: csvFile(csvBody),
  });
  expect(uploadRes.status).toBe(200);
  const preview = await uploadRes.json();
  const confirmRes = await fetch(`${base}/api/ingest/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ previewId: preview.previewId }),
  });
  expect(confirmRes.status).toBe(201);
  return confirmRes.json() as Promise<{
    projects: Array<{ name: string; bullets: string[]; status?: string }>;
    issues: { empty: boolean; items: Array<{ text: string }> };
    nextWeek: Array<{ projectName: string; items: string[] }>;
  }>;
}

describe("ingest HTTP API", () => {
  it("uploads CSV, previews error rows, confirms mapping into a report, and skips error rows", async () => {
    const { base, store, ingestStore } = await startApi();
    const uploadRes = await fetch(`${base}/api/ingest/upload`, {
      method: "POST",
      body: csvFile(
        [
          CSV_HEADERS,
          "联调设备协议,进行中,设备管理,张三,与硬件联调,2026-09-20,dev-1",
          "登录失败,缺陷,设备管理,,,,bug-1",
          "下周压测,待处理,设备管理,,,,plan-1",
          ",进行中,设备管理,,,,bad-1",
        ].join("\n"),
      ),
    });
    expect(uploadRes.status).toBe(200);
    const preview = await uploadRes.json();
    expect(preview.previewId).toBeTruthy();
    expect(preview.summary).toEqual({ total: 4, ok: 3, error: 1 });
    expect(preview.rows.some((row: { ok: boolean; error?: string }) => !row.ok && row.error)).toBe(
      true,
    );

    const confirmRes = await fetch(`${base}/api/ingest/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        previewId: preview.previewId,
        reportPartial: { title: "上传周报", department: "软件研发" },
      }),
    });
    expect(confirmRes.status).toBe(201);
    const report = await confirmRes.json();
    expect(report.title).toBe("上传周报");
    expect(report.status).toBe("draft");
    expect(report.projects.some((p: { name: string }) => p.name === "设备管理")).toBe(true);
    expect(report.issues.empty).toBe(false);
    expect(report.nextWeek.some((row: { items: string[] }) => row.items.includes("下周压测"))).toBe(
      true,
    );
    const allText = JSON.stringify(report);
    expect(allText).not.toMatch(/bad-1/);
    expect(await store.get(report.id)).toBeTruthy();

    const raw = await ingestStore.listByPreview(preview.previewId);
    expect(raw).toHaveLength(4);
    expect(raw.every((row: { source: string }) => row.source === "upload")).toBe(true);
    expect(raw.filter((row: { ok: boolean }) => !row.ok)).toHaveLength(1);

    const again = await fetch(`${base}/api/ingest/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previewId: preview.previewId }),
    });
    expect(again.status).toBe(404);
  });

  it("QA gate: five upload cases lock 模块 / 【】 / 其他 and 处理中/已完成/进行中/完成 → projects", async () => {
    const { base } = await startApi();
    const report = await uploadAndConfirm(
      base,
      [
        "事项标题,状态,模块",
        "处理中联调,处理中,设备管理",
        "已完成提测,已完成,设备管理",
        "【形态学】标注,进行中,",
        "无模块事项,完成,",
        "【忽略】动态学联调,处理中,动态学app",
      ].join("\n"),
    );
    expect(report.issues.empty).toBe(true);
    expect(report.nextWeek).toEqual([]);
    expect(report.projects.map((p) => p.name).sort()).toEqual(
      ["动态学app", "其他", "形态学", "设备管理"].sort(),
    );
    const device = report.projects.find((p) => p.name === "设备管理");
    expect(device?.bullets).toEqual(["[处理中] 处理中联调", "[已完成] 已完成提测"]);
    expect(report.projects.find((p) => p.name === "形态学")?.bullets).toEqual(["[进行中] 标注"]);
    expect(report.projects.find((p) => p.name === "其他")?.bullets).toEqual(["[完成] 无模块事项"]);
    expect(report.projects.find((p) => p.name === "动态学app")?.bullets).toEqual([
      "[处理中] 【忽略】动态学联调",
    ]);
  });

  it("QA gate: merge sample keeps the longer formal name", async () => {
    const { base } = await startApi();
    const report = await uploadAndConfirm(
      base,
      [
        "事项标题,状态,模块",
        "短名联调,处理中,设备",
        "长名提测,已完成,设备管理",
        "形态学标注,处理中,形态学",
        "形态学提测,已完成,形态学鉴定APP",
      ].join("\n"),
    );
    expect(report.projects).toHaveLength(2);
    expect(report.projects.map((p) => p.name).sort()).toEqual(["形态学鉴定APP", "设备管理"].sort());
    expect(report.projects.find((p) => p.name === "设备管理")?.bullets).toEqual([
      "[处理中] 短名联调",
      "[已完成] 长名提测",
    ]);
    expect(report.projects.find((p) => p.name === "形态学鉴定APP")?.bullets).toEqual([
      "[处理中] 形态学标注",
      "[已完成] 形态学提测",
    ]);
    expect(report.nextWeek).toEqual([]);
  });

  it("parses xlsx the same way as csv", async () => {
    const { base } = await startApi();
    const res = await fetch(`${base}/api/ingest/upload`, {
      method: "POST",
      body: xlsxFile([
        ["事项标题", "状态", "模块"],
        ["联调", "进行中", "设备管理"],
      ]),
    });
    expect(res.status).toBe(200);
    const preview = await res.json();
    expect(preview.summary).toEqual({ total: 1, ok: 1, error: 0 });
    expect(preview.rows[0]).toMatchObject({ title: "联调", status: "进行中", module: "设备管理" });
  });

  it("cancels a preview with 204 and does not write wr_reports", async () => {
    const { base, store, ingestStore } = await startApi();
    const preview = await (
      await fetch(`${base}/api/ingest/upload`, {
        method: "POST",
        body: csvFile("事项标题,状态\n联调,进行中\n"),
      })
    ).json();

    const cancelRes = await fetch(`${base}/api/ingest/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previewId: preview.previewId }),
    });
    expect(cancelRes.status).toBe(204);
    expect(await store.list()).toEqual([]);
    expect(await ingestStore.listByPreview(preview.previewId)).toEqual([]);

    const confirmRes = await fetch(`${base}/api/ingest/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previewId: preview.previewId }),
    });
    expect(confirmRes.status).toBe(404);
    expect(await store.list()).toEqual([]);
  });

  it("re-uploads the same file into wr_ingest_raw without duplicating report items", async () => {
    const { base, store, ingestStore } = await startApi();
    const file = csvFile(
      ["事项标题,状态,模块,来源ID", "联调,进行中,设备管理,same-1", "联调,进行中,设备管理,same-1"].join(
        "\n",
      ),
    );

    const firstPreview = await (
      await fetch(`${base}/api/ingest/upload`, { method: "POST", body: file })
    ).json();
    expect(firstPreview.summary.ok).toBe(2);
    const firstReport = await (
      await fetch(`${base}/api/ingest/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewId: firstPreview.previewId }),
      })
    ).json();
    expect(firstReport.projects[0].bullets).toEqual(["[进行中] 联调"]);

    const secondFile = csvFile(
      ["事项标题,状态,模块,来源ID", "联调,进行中,设备管理,same-1", "联调,进行中,设备管理,same-1"].join(
        "\n",
      ),
    );
    const secondPreview = await (
      await fetch(`${base}/api/ingest/upload`, { method: "POST", body: secondFile })
    ).json();
    const secondRes = await fetch(`${base}/api/ingest/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previewId: secondPreview.previewId }),
    });
    expect(secondRes.status).toBe(201);
    const secondReport = await secondRes.json();
    expect(secondReport.id).not.toBe(firstReport.id);
    expect(secondReport.projects).toEqual([]);
    expect(await ingestStore.listByPreview(firstPreview.previewId)).toHaveLength(2);
    expect(await ingestStore.listByPreview(secondPreview.previewId)).toHaveLength(2);
    expect(await store.get(firstReport.id)).toBeTruthy();
    expect(await store.get(secondReport.id)).toBeTruthy();
  });

  it("rejects missing file and unknown previewId", async () => {
    const { base } = await startApi();
    const noFile = await fetch(`${base}/api/ingest/upload`, {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=abc" },
      body: "--abc--",
    });
    expect(noFile.status).toBe(400);

    const missing = await fetch(`${base}/api/ingest/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previewId: "no-such-preview" }),
    });
    expect(missing.status).toBe(404);

    const cancelMissing = await fetch(`${base}/api/ingest/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(cancelMissing.status).toBe(400);
  });
});

async function probeMysql() {
  try {
    const cfg = mysqlConfigFromEnv();
    const conn = await mysql.createConnection({ ...cfg, connectTimeout: 3000 });
    await conn.query("SELECT 1");
    await conn.end();
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

const mysqlStatus = await probeMysql();
const mysqlPreviewIds: string[] = [];
const mysqlReportIds: string[] = [];

afterEach(async () => {
  if (!mysqlStatus.ok) return;
  const ingest = (await import("./ingest.js")).createIngestRawStore();
  const reports = createReportStore();
  try {
    while (mysqlPreviewIds.length) {
      const id = mysqlPreviewIds.pop();
      if (id) await ingest.deleteByPreviewId(id);
    }
    while (mysqlReportIds.length) {
      const id = mysqlReportIds.pop();
      if (id) {
        try {
          await reports.delete(id);
        } catch {
          // already gone
        }
      }
    }
  } finally {
    await ingest.close();
    await reports.close();
  }
});

describe.skipIf(!mysqlStatus.ok)("MySQL wr_ingest_raw", () => {
  it("persists raw rows including errors and never uses non-wr_ tables", async () => {
    expect(INGEST_RAW_TABLE).toBe("wr_ingest_raw");
    const { createIngestRawStore, confirmIngestPreview, uploadIngestFile, createMemoryPreviewStore } =
      await import("./ingest.js");
    const ingestStore = createIngestRawStore();
    const previewStore = createMemoryPreviewStore();
    const reportStore = createReportStore();
    try {
      const preview = await uploadIngestFile({
        buffer: Buffer.from("事项标题,状态,来源ID\n联调,进行中,m-1\n,进行中,m-bad\n"),
        filename: "mysql.csv",
        contentType: "text/csv",
        previewStore,
      });
      mysqlPreviewIds.push(preview.previewId);
      const report = await confirmIngestPreview({
        body: { previewId: preview.previewId, reportPartial: { title: "MySQL上传" } },
        previewStore,
        ingestStore,
        reportStore,
      });
      mysqlReportIds.push(report.id);
      const raw = await ingestStore.listByPreview(preview.previewId);
      expect(raw).toHaveLength(2);
      expect(raw.map((row) => row.ok)).toEqual([true, false]);
      expect(raw[0].source).toBe("upload");
      expect((report as unknown as { projects: { bullets: string[] }[] }).projects[0].bullets).toEqual([
        "[进行中] 联调",
      ]);
    } finally {
      await ingestStore.close();
      await reportStore.close();
    }
  });
});
