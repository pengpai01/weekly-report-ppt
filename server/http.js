import {
  cancelIngestPreview,
  confirmIngestPreview,
  extractMultipartFile,
  readRequestBuffer,
  resolveIngestRawStore,
  resolvePreviewStore,
  uploadIngestFile,
} from "./ingest.js";
import {
  importYunxiaoWorkitems,
  parseUpdatedWithinDays,
  resolveYunxiaoClient,
  resolveYunxiaoItemsStore,
  syncYunxiaoWorkitems,
} from "./yunxiao.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function send(res, status, body) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendNoContent(res) {
  res.writeHead(204, CORS);
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function parseJsonBody(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    const error = new Error("Request body must be a JSON object");
    error.status = 400;
    throw error;
  } catch (err) {
    if (err.status) throw err;
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}

function requestUrl(req) {
  const raw = req.originalUrl || req.url || "/";
  try {
    return new URL(raw, "http://localhost");
  } catch {
    return new URL(String(raw).split("?")[0] || "/", "http://localhost");
  }
}

function requestPath(req) {
  return requestUrl(req).pathname.replace(/\/+$/, "") || "/";
}

/**
 * Route /api/* against the report store (and read-only Yunxiao import).
 * @returns {Promise<boolean>} true if the request was handled
 */
export async function routeApi(store, req, res, deps = {}) {
  const pathname = requestPath(req);
  if (!pathname.startsWith("/api/")) return false;

  if (req.method === "OPTIONS") {
    sendNoContent(res);
    return true;
  }

  try {
    if (pathname === "/api/ingest/upload") {
      if (req.method === "POST") {
        const buffer = await readRequestBuffer(req);
        const file = extractMultipartFile(buffer, req.headers["content-type"]);
        const preview = await uploadIngestFile({
          buffer: file.buffer,
          filename: file.filename,
          contentType: file.contentType,
          previewStore: resolvePreviewStore(deps),
        });
        send(res, 200, preview);
        return true;
      }
      send(res, 405, { error: "Method not allowed" });
      return true;
    }

    // Optional JSON: moduleAutoMerge?: boolean (default true),
    // materials?: { projects, issues, nextWeek } (each an array; stored as-is).
    if (pathname === "/api/ingest/confirm") {
      if (req.method === "POST") {
        const body = await parseJsonBody(req);
        const report = await confirmIngestPreview({
          body,
          previewStore: resolvePreviewStore(deps),
          ingestStore: resolveIngestRawStore(deps),
          reportStore: store,
        });
        send(res, 201, report);
        return true;
      }
      send(res, 405, { error: "Method not allowed" });
      return true;
    }

    if (pathname === "/api/ingest/cancel") {
      if (req.method === "POST") {
        const body = await parseJsonBody(req);
        await cancelIngestPreview({
          body,
          previewStore: resolvePreviewStore(deps),
        });
        sendNoContent(res);
        return true;
      }
      send(res, 405, { error: "Method not allowed" });
      return true;
    }

    if (pathname === "/api/yunxiao/workitems") {
      if (req.method === "GET") {
        const days = parseUpdatedWithinDays(requestUrl(req).searchParams.get("updatedWithinDays"));
        const client = resolveYunxiaoClient(deps);
        const itemsStore = resolveYunxiaoItemsStore(deps);
        send(res, 200, await syncYunxiaoWorkitems({ client, itemsStore, updatedWithinDays: days }));
        return true;
      }
      send(res, 405, { error: "Method not allowed" });
      return true;
    }

    // Same optional moduleAutoMerge / materials fields as POST /api/ingest/confirm.
    if (pathname === "/api/yunxiao/import") {
      if (req.method === "POST") {
        const body = await parseJsonBody(req);
        const itemsStore = resolveYunxiaoItemsStore(deps);
        const report = await importYunxiaoWorkitems({
          reportStore: store,
          itemsStore,
          client: deps.yunxiaoClient || null,
          body,
          resolveClient: () => resolveYunxiaoClient(deps),
        });
        send(res, 201, report);
        return true;
      }
      send(res, 405, { error: "Method not allowed" });
      return true;
    }

    if (pathname === "/api/reports") {
      if (req.method === "GET") {
        send(res, 200, await store.list());
        return true;
      }
      if (req.method === "POST") {
        const body = await parseJsonBody(req);
        send(res, 201, await store.create(body));
        return true;
      }
      send(res, 405, { error: "Method not allowed" });
      return true;
    }

    const match = /^\/api\/reports\/([^/]+)$/.exec(pathname);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (req.method === "GET") {
        const report = await store.get(id);
        if (!report) {
          send(res, 404, { error: "Report not found" });
          return true;
        }
        send(res, 200, report);
        return true;
      }
      if (req.method === "PUT") {
        const body = await parseJsonBody(req);
        send(res, 200, await store.update(id, body));
        return true;
      }
      if (req.method === "DELETE") {
        await store.delete(id);
        sendNoContent(res);
        return true;
      }
      send(res, 405, { error: "Method not allowed" });
      return true;
    }

    send(res, 404, { error: "Not found" });
    return true;
  } catch (err) {
    const status = err.status || 500;
    send(res, status, { error: err.message || "Server error" });
    return true;
  }
}

export function createConnectApi(store, deps = {}) {
  return (req, res, next) => {
    const pathname = requestPath(req);
    if (!pathname.startsWith("/api/")) {
      next();
      return;
    }
    routeApi(store, req, res, deps).catch(next);
  };
}
