import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendServerLog, defaultDataDir, listenPort, mysqlConfigFromEnv, REPORTS_TABLE, SERVICE_NAME } from "./config.js";
import { createReportStore } from "./store.js";
import { routeApi } from "./http.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function sendFile(res, file, status = 200) {
  const type = MIME[extname(file)] || "application/octet-stream";
  res.writeHead(status, { "Content-Type": type });
  createReadStream(file).pipe(res);
}

function serveStatic(req, res, distDir) {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const hasExt = Boolean(extname(urlPath));
  const candidate = resolve(distDir, `.${hasExt ? urlPath : "/index.html"}`);
  if (!candidate.startsWith(distDir)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    sendFile(res, candidate);
    return;
  }
  const index = join(distDir, "index.html");
  if (existsSync(index)) {
    sendFile(res, index);
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Frontend build missing. Run npm run build first.");
}

export async function startServer(options = {}) {
  const host = options.host ?? process.env.HOST ?? "0.0.0.0";
  const port = Number(options.port ?? listenPort());
  const dataDir = options.dataDir ?? defaultDataDir();
  const distDir = resolve(
    options.distDir ?? fileURLToPath(new URL("../dist", import.meta.url)),
  );
  const store = options.store ?? createReportStore({ dataDir });
  const mysql = mysqlConfigFromEnv();

  await store.list();
  appendServerLog(
    `${SERVICE_NAME} listening host=${host} port=${port} mysql=${mysql.host}:${mysql.port}/${mysql.database} table=${REPORTS_TABLE}`,
    dataDir,
  );

  const server = createServer(async (req, res) => {
    const handled = await routeApi(store, req, res);
    if (!handled) serveStatic(req, res, distDir);
  });

  return new Promise((resolvePromise) => {
    server.listen(port, host, () => {
      const shownHost = host === "0.0.0.0" ? "localhost" : host;
      console.log(`[${SERVICE_NAME}] listening on http://${shownHost}:${port}`);
      console.log(`MySQL: ${mysql.user}@${mysql.host}:${mysql.port}/${mysql.database} (table ${REPORTS_TABLE} only)`);
      console.log(`Local files (logs): ${dataDir}`);
      resolvePromise(server);
    });
  });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  startServer().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
