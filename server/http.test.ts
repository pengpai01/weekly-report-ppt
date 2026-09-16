import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createMemoryReportStore } from "./store.js";
import { routeApi } from "./http.js";

const servers: import("node:http").Server[] = [];

async function startApi() {
  const store = createMemoryReportStore();
  const server = createServer((req, res) => {
    void routeApi(store, req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404).end();
      }
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

describe("reports HTTP API", () => {
  it("covers create, list, detail, update overwrite, and delete", async () => {
    const { base } = await startApi();

    const createdRes = await fetch(`${base}/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "周工作总结",
        templateType: "weekly",
        department: "软件研发",
        date: "2026-09-16",
        author: "测试",
        projects: [{ id: "p1", name: "设备管理", bullets: ["联调"] }],
        issues: { empty: true, items: [] },
        nextWeek: [{ id: "n1", projectName: "设备管理", items: ["上线"] }],
      }),
    });
    expect(createdRes.status).toBe(201);
    const created = await createdRes.json();
    expect(created.id).toBeTruthy();
    expect(created.status).toBe("draft");
    expect(created.department).toBe("软件研发");

    const listRes = await fetch(`${base}/api/reports`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);

    const detailRes = await fetch(`${base}/api/reports/${created.id}`);
    expect(detailRes.status).toBe(200);
    expect((await detailRes.json()).title).toBe("周工作总结");

    const putRes = await fetch(`${base}/api/reports/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...created,
        title: "双周工作总结",
        templateType: "biweekly",
        status: "generated",
        projects: [{ id: "p1", name: "设备管理", bullets: ["联调", "提测"] }],
      }),
    });
    expect(putRes.status).toBe(200);
    const updated = await putRes.json();
    expect(updated.title).toBe("双周工作总结");
    expect(updated.templateType).toBe("biweekly");
    expect(updated.status).toBe("generated");
    expect(updated.projects[0].bullets).toEqual(["联调", "提测"]);
    expect(updated.createdAt).toBe(created.createdAt);

    const afterPut = await (await fetch(`${base}/api/reports/${created.id}`)).json();
    expect(afterPut.title).toBe("双周工作总结");

    const delRes = await fetch(`${base}/api/reports/${created.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(204);

    const missing = await fetch(`${base}/api/reports/${created.id}`);
    expect(missing.status).toBe(404);
  });
});
