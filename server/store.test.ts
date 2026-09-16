import mysql from "mysql2/promise";
import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  assertInsideProject,
  mysqlConfigFromEnv,
  PROJECT_ROOT,
  REPORTS_TABLE,
  TABLE_PREFIX,
} from "./config.js";
import {
  createMemoryReportStore,
  createReportStore,
  normalizeReport,
} from "./store.js";

describe("isolation constants", () => {
  it("owns only wr_ prefixed tables", () => {
    expect(TABLE_PREFIX).toBe("wr_");
    expect(REPORTS_TABLE).toBe("wr_reports");
    expect(REPORTS_TABLE.startsWith(TABLE_PREFIX)).toBe(true);
  });

  it("rejects local paths outside the project root", () => {
    expect(() => assertInsideProject(resolve(PROJECT_ROOT, "..", "other"), "DATA_DIR")).toThrow(
      /must stay under project root/,
    );
    expect(assertInsideProject(resolve(PROJECT_ROOT, "data"), "DATA_DIR")).toBe(
      resolve(PROJECT_ROOT, "data"),
    );
  });
});

describe("normalizeReport", () => {
  it("fills defaults and keeps id/createdAt on update", () => {
    const created = normalizeReport({ title: "周工作总结", department: "研发" });
    expect(created.id).toBeTruthy();
    expect(created.status).toBe("draft");
    expect(created.projects.length).toBe(1);

    const updated = normalizeReport({ title: "已更新", status: "generated" }, created);
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.title).toBe("已更新");
    expect(updated.department).toBe("研发");
  });
});

describe("memory report store", () => {
  it("creates, lists by updatedAt desc, updates, and deletes", async () => {
    const store = createMemoryReportStore();
    const older = await store.create({ title: "旧稿", department: "研发" });
    await new Promise((r) => setTimeout(r, 5));
    const newer = await store.create({ title: "新稿", department: "产品" });

    const list = await store.list();
    expect(list.map((r) => r.id)).toEqual([newer.id, older.id]);

    const updated = await store.update(older.id, { ...older, title: "旧稿-已改", status: "generated" });
    expect(updated.title).toBe("旧稿-已改");
    expect((await store.list())[0].id).toBe(older.id);

    await store.delete(older.id);
    expect(await store.get(older.id)).toBeNull();
    await expect(store.delete(older.id)).rejects.toThrow(/not found/i);
  });

  it("reuses a client-provided id on create", async () => {
    const store = createMemoryReportStore();
    const created = await store.create({ id: "draft-1", title: "指定 id" });
    expect(created.id).toBe("draft-1");
    await expect(store.create({ id: "draft-1" })).rejects.toThrow(/already exists/i);
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
const createdIds: string[] = [];

afterEach(async () => {
  if (!mysqlStatus.ok || createdIds.length === 0) return;
  const store = createReportStore();
  try {
    while (createdIds.length) {
      const id = createdIds.pop();
      if (id) {
        try {
          await store.delete(id);
        } catch {
          // already deleted
        }
      }
    }
  } finally {
    await store.close();
  }
});

describe.skipIf(!mysqlStatus.ok)("MySQL wr_reports store", () => {
  it("persists CRUD in wr_reports and survives a new pool", async () => {
    const store = createReportStore();
    const older = await store.create({
      title: "旧稿",
      department: "研发",
      templateType: "weekly",
    });
    createdIds.push(older.id);
    await new Promise((r) => setTimeout(r, 20));
    const newer = await store.create({ title: "新稿", department: "产品" });
    createdIds.push(newer.id);

    const listed = await store.list();
    const ours = listed.filter((r) => createdIds.includes(r.id));
    expect(ours.map((r) => r.id)).toEqual([newer.id, older.id]);

    const updated = await store.update(older.id, {
      ...older,
      title: "旧稿-已改",
      status: "generated",
      projects: [{ id: "p1", name: "设备", bullets: ["联调"] }],
    });
    expect(updated.title).toBe("旧稿-已改");
    expect(updated.createdAt).toBe(older.createdAt);
    await store.close();

    const reloaded = createReportStore();
    expect((await reloaded.get(older.id))?.title).toBe("旧稿-已改");
    await reloaded.delete(older.id);
    createdIds.splice(createdIds.indexOf(older.id), 1);
    expect(await reloaded.get(older.id)).toBeNull();
    await expect(reloaded.delete(older.id)).rejects.toThrow(/not found/i);
    await reloaded.close();
  });
});

if (!mysqlStatus.ok) {
  console.warn(`Skipping MySQL tests: ${mysqlStatus.error}`);
}
