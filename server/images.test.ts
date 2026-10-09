import { Readable } from "node:stream";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { allowSensitiveRequest, corsHeaders } from "./access.js";
import { routeApi } from "./http.js";
import { sniffImage } from "./images.js";
import { createMemoryReportStore } from "./store.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const TOKEN = "unit-token";

const servers: import("node:http").Server[] = [];

async function startApi(deps = {}) {
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

function multipart(filename: string, bytes: Buffer, type = "application/octet-stream") {
  const boundary = "----imagetest";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([head, bytes, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

function mockReq({
  method,
  url,
  headers,
  body,
  remoteAddress,
}: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: Buffer;
  remoteAddress: string;
}) {
  const req = Readable.from(body ? [body] : []);
  Object.assign(req, {
    method,
    url,
    headers: headers ?? {},
    socket: { remoteAddress },
  });
  return req;
}

function mockRes() {
  let status = 0;
  let headers: Record<string, unknown> = {};
  const chunks: Buffer[] = [];
  return {
    writeHead(code: number, next: Record<string, unknown>) {
      status = code;
      headers = next;
    },
    end(payload?: Buffer | string) {
      if (payload) chunks.push(Buffer.isBuffer(payload) ? payload : Buffer.from(payload));
    },
    status: () => status,
    headers: () => headers,
    text: () => Buffer.concat(chunks).toString("utf8"),
    bytes: () => Buffer.concat(chunks),
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    ),
  );
});

async function draft(base: string) {
  const created = await fetch(`${base}/api/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "周工作总结",
      department: "软件研发",
      projects: [{ id: "p1", name: "设备管理", bullets: ["联调"] }],
      issues: { empty: false, items: [{ id: "i1", text: "环境不足" }] },
      nextWeek: [{ id: "n1", projectName: "设备管理", items: ["上线"] }],
    }),
  });
  expect(created.status).toBe(201);
  return created.json();
}

describe("image access", () => {
  it("never emits wildcard CORS and ignores a star allowlist", () => {
    const blocked = corsHeaders({ headers: { origin: "https://evil.example" } }, { CORS_ORIGINS: "*" });
    expect(blocked["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(JSON.stringify(blocked)).not.toContain("*");
    const local = corsHeaders({ headers: { origin: "http://127.0.0.1:5174" } }, {});
    expect(local["Access-Control-Allow-Origin"]).toBe("http://127.0.0.1:5174");
    expect(allowSensitiveRequest({ socket: { remoteAddress: "127.0.0.1" } })).toBe(true);
    expect(allowSensitiveRequest({ socket: { remoteAddress: "::ffff:127.0.0.1" } })).toBe(true);
    expect(allowSensitiveRequest({ socket: { remoteAddress: "203.0.113.8" }, headers: {} })).toBe(false);
    expect(
      allowSensitiveRequest(
        { socket: { remoteAddress: "203.0.113.8" }, headers: { "x-report-token": TOKEN } },
        { REPORT_API_TOKEN: TOKEN },
      ),
    ).toBe(true);
  });

  it("sniffs png, jpeg, gif, and webp and rejects other bytes", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBe("image/jpeg");
    expect(sniffImage(Buffer.from("GIF89aXXXX", "ascii"))).toBe("image/gif");
    const webp = Buffer.alloc(12);
    webp.write("RIFF", 0, "ascii");
    webp.write("WEBP", 8, "ascii");
    expect(sniffImage(webp)).toBe("image/webp");
    expect(sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImage(Buffer.from("not-an-image"))).toBeNull();
  });
});

describe("report image HTTP", () => {
  it("uploads into a cover slot, serves bytes, and does not rewrite other zones", async () => {
    const { base, store } = await startApi();
    const report = await draft(base);
    const before = await store.get(report.id);

    const bad = new FormData();
    bad.append("file", new Blob([Buffer.from("not-an-image")], { type: "image/png" }), "notes.png");
    const rejected = await fetch(`${base}/api/reports/${report.id}/images?slot=cover-1`, {
      method: "POST",
      body: bad,
    });
    expect(rejected.status).toBe(400);
    const rejectedBody = await rejected.json();
    expect(rejectedBody.code).toBe("image.unsupported");
    expect(rejectedBody.error).toContain("草稿未改动");
    expect(rejected.headers.get("access-control-allow-origin")).not.toBe("*");

    const afterReject = await store.get(report.id);
    expect(afterReject).toEqual(before);
    expect(await store.listImages(report.id)).toEqual([]);

    const unknown = new FormData();
    unknown.append("file", new Blob([PNG], { type: "image/png" }), "tile.png");
    const badSlot = await fetch(`${base}/api/reports/${report.id}/images?slot=logo`, {
      method: "POST",
      body: unknown,
    });
    expect(badSlot.status).toBe(400);
    expect((await badSlot.json()).code).toBe("image.slot");
    expect(await store.listImages(report.id)).toEqual([]);

    const form = new FormData();
    form.append("file", new Blob([PNG], { type: "image/png" }), "tile.png");
    const uploaded = await fetch(`${base}/api/reports/${report.id}/images?slot=cover-1`, {
      method: "POST",
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const saved = await uploaded.json();
    expect(saved.image.slot).toBe("cover-1");
    expect(saved.image.mime).toBe("image/png");
    expect(saved.images).toHaveLength(1);

    const still = await store.get(report.id);
    expect(still?.title).toBe(before?.title);
    expect(still?.updatedAt).toBe(before?.updatedAt);
    expect(still?.projects).toEqual(before?.projects);
    expect(still?.issues).toEqual(before?.issues);
    expect(still?.nextWeek).toEqual(before?.nextWeek);
    expect(still?.slides).toEqual(before?.slides);

    const bytes = await fetch(`${base}/api/reports/${report.id}/images/${saved.image.id}`);
    expect(bytes.status).toBe(200);
    expect(bytes.headers.get("content-type")).toBe("image/png");
    expect(bytes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await bytes.arrayBuffer()).equals(PNG)).toBe(true);

    const detail = await (await fetch(`${base}/api/reports/${report.id}`)).json();
    expect(detail.projects).toEqual(report.projects);
    expect(detail.images).toEqual(saved.images);

    const forged = await fetch(`${base}/api/reports/${report.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...detail,
        title: "已改标题",
        images: [{ id: "forged", slot: "cover-1", mime: "image/png", filename: "x.png", byteLength: 1 }],
      }),
    });
    expect(forged.status).toBe(200);
    const afterPut = await forged.json();
    expect(afterPut.title).toBe("已改标题");
    expect(afterPut.images.map((image: { id: string }) => image.id)).toEqual([saved.image.id]);
    expect(afterPut.projects).toEqual(detail.projects);
  });

  it("replaces one slot and deletes it without touching the draft text", async () => {
    const { base, store } = await startApi();
    const report = await draft(base);
    const first = new FormData();
    first.append("file", new Blob([PNG], { type: "image/png" }), "a.png");
    const created = await (await fetch(`${base}/api/reports/${report.id}/images?slot=cover-2`, {
      method: "POST",
      body: first,
    })).json();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const second = new FormData();
    second.append("file", new Blob([jpeg], { type: "image/jpeg" }), "b.jpg");
    const replaced = await fetch(`${base}/api/reports/${report.id}/images?slot=cover-2`, {
      method: "POST",
      body: second,
    });
    expect(replaced.status).toBe(201);
    const body = await replaced.json();
    expect(body.images).toHaveLength(1);
    expect(body.image.id).not.toBe(created.image.id);
    expect(body.image.mime).toBe("image/jpeg");
    const stale = await fetch(`${base}/api/reports/${report.id}/images/${created.image.id}`);
    expect(stale.status).toBe(404);

    const removed = await fetch(`${base}/api/reports/${report.id}/images/${body.image.id}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ images: [] });
    const after = await store.get(report.id);
    expect(after?.title).toBe("周工作总结");
    expect(after?.projects).toEqual(report.projects);
    expect(await store.listImages(report.id)).toEqual([]);
  });

  it("refuses non-loopback upload and ingest unless the server token matches", async () => {
    const store = createMemoryReportStore();
    const report = await store.create({ title: "周报", projects: [{ id: "p1", name: "设备", bullets: ["联调"] }] });
    const file = multipart("tile.png", PNG, "image/png");
    const deniedRes = mockRes();
    await routeApi(
      store,
      mockReq({
        method: "POST",
        url: `/api/reports/${report.id}/images?slot=cover-3`,
        headers: file.headers,
        body: file.body,
        remoteAddress: "203.0.113.8",
      }) as unknown as IncomingMessage,
      deniedRes as unknown as ServerResponse,
    );
    expect(deniedRes.status()).toBe(403);
    expect(JSON.parse(deniedRes.text()).code).toBe("access.forbidden");
    expect(JSON.stringify(deniedRes.headers())).not.toContain("*");
    expect(await store.listImages(report.id)).toEqual([]);
    expect((await store.get(report.id))?.projects).toEqual(report.projects);

    const ingestRes = mockRes();
    await routeApi(
      store,
      mockReq({
        method: "POST",
        url: "/api/ingest/upload",
        headers: file.headers,
        body: file.body,
        remoteAddress: "203.0.113.8",
      }) as unknown as IncomingMessage,
      ingestRes as unknown as ServerResponse,
    );
    expect(ingestRes.status()).toBe(403);

    const allowedRes = mockRes();
    await routeApi(
      store,
      mockReq({
        method: "POST",
        url: `/api/reports/${report.id}/images?slot=cover-3`,
        headers: { ...file.headers, "x-report-token": TOKEN },
        body: file.body,
        remoteAddress: "203.0.113.9",
      }) as unknown as IncomingMessage,
      allowedRes as unknown as ServerResponse,
      { accessEnv: { REPORT_API_TOKEN: TOKEN } },
    );
    expect(allowedRes.status()).toBe(201);
    const saved = JSON.parse(allowedRes.text());
    expect(saved.image.slot).toBe("cover-3");
    expect((await store.get(report.id))?.title).toBe("周报");

    const wrongRes = mockRes();
    await routeApi(
      store,
      mockReq({
        method: "POST",
        url: `/api/reports/${report.id}/images?slot=cover-1`,
        headers: { ...file.headers, "x-report-token": "nope" },
        body: file.body,
        remoteAddress: "203.0.113.9",
      }) as unknown as IncomingMessage,
      wrongRes as unknown as ServerResponse,
      { accessEnv: { REPORT_API_TOKEN: TOKEN } },
    );
    expect(wrongRes.status()).toBe(403);
    expect(await store.listImages(report.id)).toHaveLength(1);
  });

  it("echoes only loopback origins on API responses", async () => {
    const { base } = await startApi();
    const evil = await fetch(`${base}/api/reports`, { headers: { Origin: "https://evil.example" } });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    const local = await fetch(`${base}/api/reports`, { headers: { Origin: "http://localhost:5174" } });
    expect(local.headers.get("access-control-allow-origin")).toBe("http://localhost:5174");
  });
});
