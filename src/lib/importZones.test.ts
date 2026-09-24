import { describe, expect, it } from "vitest";
import { mapIngestRowsToReport, parseIngestSpreadsheet } from "../../server/ingest.js";
import { mapYunxiaoItemsToReport } from "../../server/yunxiao.js";
import { buildZoneSnapshot } from "./importZones";

describe("import zone preview", () => {
  it("matches Yunxiao server mapping with module merge on and off", () => {
    const items = [
      { id: "1", title: "【设备】协议联调", category: "任务", status: "进行中", assignee: "张三", updatedAt: "2026-09-16T00:00:00.000Z" },
      { id: "2", title: "【设备管理】提测固件", category: "任务", status: "已完成", updatedAt: "2026-09-16T00:00:00.000Z" },
      { id: "b1", title: "【设备】登录失败", category: "缺陷", status: "待处理", updatedAt: "2026-09-16T00:00:00.000Z" },
      { id: "n1", title: "【设备】下周压测", category: "任务", status: "待处理", updatedAt: "2026-09-16T00:00:00.000Z" },
    ];
    for (const moduleAutoMerge of [true, false]) {
      const server = mapYunxiaoItemsToReport(items, {}, { moduleAutoMerge });
      const client = buildZoneSnapshot(items, moduleAutoMerge);
      expect(client.projects.map((project) => project.name)).toEqual(server.projects.map((project) => project.name));
      expect(client.projects.map((project) => project.bullets)).toEqual(
        server.projects.map((project) => project.bullets),
      );
      expect(client.projects.map((project) => project.status)).toEqual(
        server.projects.map((project) => project.status),
      );
      expect(client.issues.empty).toBe(server.issues.empty);
      expect(client.issues.items.map((item) => item.text)).toEqual(server.issues.items.map((item) => item.text));
      expect(client.nextWeek.map((row) => row.projectName)).toEqual(server.nextWeek.map((row) => row.projectName));
      expect(client.nextWeek.map((row) => row.items)).toEqual(server.nextWeek.map((row) => row.items));
    }
  });

  it("matches spreadsheet server mapping for similar module names", () => {
    const parsed = parseIngestSpreadsheet(
      Buffer.from(
        [
          "事项标题,状态,模块,负责人,详情",
          "协议联调,处理中,设备,张三,联调细节",
          "提测固件,已完成,设备管理,,",
          "登录失败,Bug,设备管理,,",
          "下周压测,待处理,设备管理,,",
        ].join("\n"),
      ),
      "merge.csv",
    );
    const rows = parsed.rows.filter((row) => row.ok);
    const server = mapIngestRowsToReport(rows, {}, { moduleAutoMerge: true });
    const client = buildZoneSnapshot(
      rows.map((row) => ({
        id: String(row.row),
        title: row.title,
        status: row.status,
        module: row.module,
        assignee: row.owner,
        detail: row.detail,
      })),
      true,
    );
    expect(client.projects.map((project) => project.name)).toEqual(server.projects.map((project) => project.name));
    expect(client.projects.map((project) => project.bullets)).toEqual(server.projects.map((project) => project.bullets));
    expect(client.issues.items.map((item) => item.text)).toEqual(server.issues.items.map((item) => item.text));
    expect(client.nextWeek.map((row) => row.items)).toEqual(server.nextWeek.map((row) => row.items));
  });
});
