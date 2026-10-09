import { formatAiFailureLog, redactAiMessage, summarizeMaterials } from "./ai.js";
import { allowSensitiveRequest, corsHeaders } from "./access.js";
import { appendServerLog } from "./config.js";
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
  isImageSlot,
  MAX_IMAGE_BODY_BYTES,
  MAX_IMAGE_BYTES,
  safeImageFilename,
  sniffImage,
} from "./images.js";
import {
  importYunxiaoWorkitems,
  parseUpdatedWithinDays,
  resolveYunxiaoClient,
  resolveYunxiaoItemsStore,
  syncYunxiaoWorkitems,
} from "./yunxiao.js";

const FORBIDDEN_BODY = {
  error:
    "该接口只允许本机访问。非本机调用需在服务端配置 REPORT_API_TOKEN，并在请求头携带 x-report-token。不要把令牌写入前端仓库。",
  code: "access.forbidden",
};

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

function logAiFailure(entry) {
  appendServerLog(formatAiFailureLog(entry));
}

/**
 * Route /api/* against the report store (and read-only Yunxiao import).
 * @returns {Promise<boolean>} true if the request was handled
 */
export async function routeApi(store, req, res, deps = {}) {
  const pathname = requestPath(req);
  if (!pathname.startsWith("/api/")) return false;

  const env = deps.accessEnv ?? process.env;

  function reply(status, body) {
    const payload = body === undefined ? "" : JSON.stringify(body);
    res.writeHead(status, {
      ...corsHeaders(req, env),
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  function noContent() {
    res.writeHead(204, corsHeaders(req, env));
    res.end();
  }

  function sendBytes(status, data, mime) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    res.writeHead(status, {
      ...corsHeaders(req, env),
      "Content-Type": mime,
      "Content-Length": buf.length,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(buf);
  }

  async function withImages(report) {
    if (!report) return report;
    const images = typeof store.listImages === "function" ? await store.listImages(report.id) : [];
    return { ...report, images };
  }

  if (req.method === "OPTIONS") {
    noContent();
    return true;
  }

  try {
    if (pathname === "/api/ingest/upload") {
      if (req.method === "POST") {
        if (!allowSensitiveRequest(req, env)) {
          reply(403, FORBIDDEN_BODY);
          return true;
        }
        const buffer = await readRequestBuffer(req);
        const file = extractMultipartFile(buffer, req.headers["content-type"]);
        const preview = await uploadIngestFile({
          buffer: file.buffer,
          filename: file.filename,
          contentType: file.contentType,
          previewStore: resolvePreviewStore(deps),
        });
        reply(200, preview);
        return true;
      }
      reply(405, { error: "Method not allowed" });
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
        reply(201, await withImages(report));
        return true;
      }
      reply(405, { error: "Method not allowed" });
      return true;
    }

    if (pathname === "/api/ingest/cancel") {
      if (req.method === "POST") {
        const body = await parseJsonBody(req);
        await cancelIngestPreview({
          body,
          previewStore: resolvePreviewStore(deps),
        });
        noContent();
        return true;
      }
      reply(405, { error: "Method not allowed" });
      return true;
    }

    if (pathname === "/api/yunxiao/workitems") {
      if (req.method === "GET") {
        const days = parseUpdatedWithinDays(requestUrl(req).searchParams.get("updatedWithinDays"));
        const client = resolveYunxiaoClient(deps);
        const itemsStore = resolveYunxiaoItemsStore(deps);
        reply(200, await syncYunxiaoWorkitems({ client, itemsStore, updatedWithinDays: days }));
        return true;
      }
      reply(405, { error: "Method not allowed" });
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
        reply(201, await withImages(report));
        return true;
      }
      reply(405, { error: "Method not allowed" });
      return true;
    }

    // Summarize only. This route must not call store.create / store.update.
    if (pathname === "/api/ai/summarize") {
      if (req.method !== "POST") {
        reply(405, { error: "Method not allowed" });
        return true;
      }
      const body = await parseJsonBody(req);
      const result = await summarizeMaterials(body, {
        env: deps.aiEnv ?? process.env,
        fetch: deps.aiFetch ?? globalThis.fetch,
        timeoutMs: deps.aiTimeoutMs,
      });
      reply(200, result);
      return true;
    }

    const imageItem = /^\/api\/reports\/([^/]+)\/images\/([^/]+)$/.exec(pathname);
    if (imageItem) {
      if (!allowSensitiveRequest(req, env)) {
        reply(403, FORBIDDEN_BODY);
        return true;
      }
      const reportId = decodeURIComponent(imageItem[1]);
      const imageId = decodeURIComponent(imageItem[2]);
      if (req.method === "GET") {
        const image = await store.readImage(reportId, imageId);
        if (!image) {
          reply(404, { error: "Image not found" });
          return true;
        }
        sendBytes(200, image.bytes, image.mime);
        return true;
      }
      if (req.method === "DELETE") {
        const removed = await store.deleteImage(reportId, imageId);
        if (!removed) {
          reply(404, { error: "Image not found" });
          return true;
        }
        reply(200, { images: await store.listImages(reportId) });
        return true;
      }
      reply(405, { error: "Method not allowed" });
      return true;
    }

    const imageCollection = /^\/api\/reports\/([^/]+)\/images$/.exec(pathname);
    if (imageCollection) {
      if (req.method !== "POST") {
        reply(405, { error: "Method not allowed" });
        return true;
      }
      if (!allowSensitiveRequest(req, env)) {
        reply(403, FORBIDDEN_BODY);
        return true;
      }
      const reportId = decodeURIComponent(imageCollection[1]);
      const slot = requestUrl(req).searchParams.get("slot") || "";
      if (!isImageSlot(slot)) {
        reply(400, {
          error: "未知的图片槽。请使用封面左上、中部或右上。草稿未改动。",
          code: "image.slot",
        });
        return true;
      }
      const existing = await store.get(reportId);
      if (!existing) {
        reply(404, { error: "Report not found" });
        return true;
      }
      const buffer = await readRequestBuffer(req, MAX_IMAGE_BODY_BYTES);
      const file = extractMultipartFile(buffer, req.headers["content-type"]);
      if (file.buffer.length > MAX_IMAGE_BYTES) {
        reply(413, {
          error: "图片超过 4MB。请压缩后再上传。草稿未改动。",
          code: "image.too_large",
        });
        return true;
      }
      const mime = sniffImage(file.buffer);
      if (!mime) {
        reply(400, {
          error: "不支持的图片格式。请上传 PNG、JPEG、GIF 或 WEBP。草稿未改动。",
          code: "image.unsupported",
        });
        return true;
      }
      const image = await store.putImage(reportId, {
        slot,
        mime,
        filename: safeImageFilename(file.filename),
        bytes: file.buffer,
      });
      reply(201, { image, images: await store.listImages(reportId) });
      return true;
    }

    if (pathname === "/api/reports") {
      if (req.method === "GET") {
        const reports = await store.list();
        reply(200, await Promise.all(reports.map((report) => withImages(report))));
        return true;
      }
      if (req.method === "POST") {
        const body = await parseJsonBody(req);
        reply(201, await withImages(await store.create(body)));
        return true;
      }
      reply(405, { error: "Method not allowed" });
      return true;
    }

    const match = /^\/api\/reports\/([^/]+)$/.exec(pathname);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (req.method === "GET") {
        const report = await store.get(id);
        if (!report) {
          reply(404, { error: "Report not found" });
          return true;
        }
        reply(200, await withImages(report));
        return true;
      }
      if (req.method === "PUT") {
        const body = await parseJsonBody(req);
        reply(200, await withImages(await store.update(id, body)));
        return true;
      }
      if (req.method === "DELETE") {
        await store.delete(id);
        noContent();
        return true;
      }
      reply(405, { error: "Method not allowed" });
      return true;
    }

    reply(404, { error: "Not found" });
    return true;
  } catch (err) {
    const status = err.status || 500;
    const aiCode = typeof err.code === "string" && err.code.startsWith("ai.") ? err.code : "";
    if (aiCode) {
      const log = deps.aiLog ?? logAiFailure;
      log({ code: aiCode, upstreamStatus: err.upstreamStatus });
    }
    const payload = {
      error: aiCode
        ? redactAiMessage(err.message || "Server error", deps.aiEnv ?? process.env)
        : err.message || "Server error",
    };
    if (aiCode) {
      payload.code = aiCode;
      payload.status = aiCode;
    }
    reply(status, payload);
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
