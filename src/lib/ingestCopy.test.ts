import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INGEST_TEMPLATE_CSV,
  INGEST_TEMPLATE_HEADERS,
  INGEST_TEMPLATE_ROWS,
  INGEST_TEMPLATE_XLSX,
  YUNZHIJIA_NOTE,
} from "./ingestCopy";

describe("ingest copy", () => {
  it("locks the 云之家旁注 wording", () => {
    expect([...YUNZHIJIA_NOTE]).toEqual([
      "主路径：复制要点粘贴拆分，或整理成模板后上传",
      "可选：群内多选近两周相关消息 → 智能生成摘要 → 粘贴拆分，或稍作整理后进模板上传",
      "说明：官方暂无历史消息 API；不承诺摘要自动解析；不做自动化抓取；机器人本期不排期",
    ]);
    const joined = YUNZHIJIA_NOTE.join("\n");
    expect(joined).not.toMatch(/多选下载/);
    expect(joined).not.toMatch(/一键导出/);
  });

  it("uses the ingest required columns in the static template", () => {
    expect(INGEST_TEMPLATE_HEADERS.slice(0, 2)).toEqual(["事项标题", "状态"]);
    expect(INGEST_TEMPLATE_ROWS.length).toBeGreaterThan(0);
    expect(INGEST_TEMPLATE_ROWS.every((row) => row[0] && row[1])).toBe(true);
  });

  it("ships public csv/xlsx templates with required headers", () => {
    const csvPath = resolve(`public${INGEST_TEMPLATE_CSV}`);
    const xlsxPath = resolve(`public${INGEST_TEMPLATE_XLSX}`);
    expect(existsSync(csvPath)).toBe(true);
    expect(existsSync(xlsxPath)).toBe(true);
    const csv = readFileSync(csvPath, "utf8");
    expect(csv).toContain("事项标题");
    expect(csv).toContain("状态");
    expect(readFileSync(xlsxPath).subarray(0, 2).toString()).toBe("PK");
  });
});
