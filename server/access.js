import { timingSafeEqual } from "node:crypto";

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** TCP peer is this machine. `::ffff:127.0.0.1` counts as loopback. */
export function isLoopbackAddress(address) {
  if (!address || typeof address !== "string") return false;
  const host = address.replace(/^::ffff:/i, "").toLowerCase();
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function configuredToken(env) {
  const value = env?.REPORT_API_TOKEN;
  return typeof value === "string" ? value.trim() : "";
}

function headerToken(req) {
  const raw = req?.headers?.["x-report-token"];
  return typeof raw === "string" ? raw : "";
}

/**
 * Upload and image routes: loopback peer, or a server-side token.
 * The token is never read from the request body and must not be embedded in the frontend.
 */
export function allowSensitiveRequest(req, env = process.env) {
  if (isLoopbackAddress(req?.socket?.remoteAddress)) return true;
  const expected = configuredToken(env);
  const presented = headerToken(req);
  if (!expected || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isAllowedOrigin(origin, env = process.env) {
  if (typeof origin !== "string" || !origin || origin === "*") return false;
  if (LOOPBACK_ORIGIN.test(origin)) return true;
  const list = String(env?.CORS_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item && item !== "*");
  return list.includes(origin);
}

/** Never emits Access-Control-Allow-Origin: *.
 * @returns {Record<string, string>}
 */
export function corsHeaders(req, env = process.env) {
  /** @type {Record<string, string>} */
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-report-token",
    Vary: "Origin",
  };
  const origin = req?.headers?.origin;
  if (typeof origin === "string" && isAllowedOrigin(origin, env)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}
