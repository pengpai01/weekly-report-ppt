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

function requestPath(req) {
  const raw = req.originalUrl || req.url || "/";
  try {
    return new URL(raw, "http://localhost").pathname.replace(/\/+$/, "") || "/";
  } catch {
    return String(raw).split("?")[0].replace(/\/+$/, "") || "/";
  }
}

/**
 * Route /api/* against the report store.
 * @returns {Promise<boolean>} true if the request was handled
 */
export async function routeApi(store, req, res) {
  const pathname = requestPath(req);
  if (!pathname.startsWith("/api/")) return false;

  if (req.method === "OPTIONS") {
    sendNoContent(res);
    return true;
  }

  try {
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

export function createConnectApi(store) {
  return (req, res, next) => {
    const pathname = requestPath(req);
    if (!pathname.startsWith("/api/")) {
      next();
      return;
    }
    routeApi(store, req, res).catch(next);
  };
}
