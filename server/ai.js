/** DeepSeek summarize. The API key stays in the server environment and is never returned. */

export const AI_TITLE_MAX = 24;
export const AI_BULLET_MAX = 60;
export const AI_PROGRESS_BULLETS_MAX = 5;
export const AI_NOT_CONFIGURED = "ai.not_configured";

const SCOPES = new Set([
  "page",
  "projects",
  "issues",
  "nextWeek",
  "project",
  "issueItem",
  "nextWeekItem",
]);
const DEFAULT_BASE = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_TIMEOUT_MS = 20_000;

const SYSTEM_PROMPT = [
  "你是周报编辑。只压缩用户给出的事实，不新增项目、数字、人名、结论或建议。",
  "只改写标题和要点，id 必须原样返回，不要返回未出现的 id。",
  "标题不超过 24 个字。每条要点不超过 60 个字。",
  "projects.bullets 最多 5 条，且不能多于原文条数。",
  "issues 的 title 是标题、text 是一条要点。nextWeek 的 projectName 是标题、items 是要点。",
  "只返回 JSON 对象，不要 Markdown。只包含输入里出现的分区键：projects、issues、nextWeek。",
].join("");

const PROJECT_SYSTEM_PROMPT = [
  "你是周报编辑。只压缩用户给出的这一条项目的要点，不新增数字、人名、结论或建议。",
  "只改写 bullets。id 必须原样返回。不要改写项目名称，不要返回 name。",
  "不要返回其他项目、issues 或 nextWeek。",
  "每条要点不超过 60 个字。bullets 最多 5 条，且不能多于原文条数。",
  "若要点里有【标签】，原样保留这对括号及其中的文字。",
  "只返回 JSON：{\"project\":{\"id\":\"原id\",\"bullets\":[\"...\"]}}",
].join("");

const ISSUE_ITEM_SYSTEM_PROMPT = [
  "你是周报编辑。只压缩这一条问题的正文 text，不新增数字、人名、结论或建议。",
  "只改写 text。id 必须原样返回。不要改写 title。",
  "不要返回其他问题、projects 或 nextWeek。",
  "text 不超过 60 个字。",
  "若正文里有【标签】，原样保留这对括号及其中的文字。",
  "只返回 JSON：{\"issue\":{\"id\":\"原id\",\"text\":\"...\"}}",
].join("");

const NEXT_ITEM_SYSTEM_PROMPT = [
  "你是周报编辑。只压缩这一行下周计划的 items，不新增数字、人名、结论或建议。",
  "只改写 items。id 必须原样返回。不要改写 projectName。",
  "不要返回其他计划、projects 或 issues。",
  "每条不超过 60 个字，条数不能多于原文。",
  "若要点里有【标签】，原样保留这对括号及其中的文字。",
  "只返回 JSON：{\"nextWeekItem\":{\"id\":\"原id\",\"items\":[\"...\"]}}",
].join("");

function systemPromptFor(scope) {
  if (scope === "project") return PROJECT_SYSTEM_PROMPT;
  if (scope === "issueItem") return ISSUE_ITEM_SYSTEM_PROMPT;
  if (scope === "nextWeekItem") return NEXT_ITEM_SYSTEM_PROMPT;
  return SYSTEM_PROMPT;
}

export function deepseekConfigured(env = process.env) {
  const value = env?.DEEPSEEK_API_KEY;
  return typeof value === "string" && value.trim() !== "";
}

/** Log line is code + upstream status only, so a key cannot be written to server.log. */
export function formatAiFailureLog(entry) {
  const code = String(entry?.code || "ai.upstream");
  const safeCode = /^ai\.[a-z0-9_]+$/.test(code) ? code : "ai.upstream";
  const upstream = Number.isInteger(entry?.upstreamStatus) ? String(entry.upstreamStatus) : "-";
  return `ai summarize failed code=${safeCode} upstream=${upstream}`;
}

export function redactAiMessage(message, env = process.env) {
  let text = String(message || "");
  const raw = env?.DEEPSEEK_API_KEY;
  const key = typeof raw === "string" ? raw.trim() : "";
  if (key) text = text.split(key).join("[redacted]");
  return text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function clip(value, max, secret) {
  const raw = String(value ?? "");
  const withoutSecret = secret ? raw.split(secret).join("") : raw;
  const clean = withoutSecret.replace(/\s+/g, " ").trim();
  return Array.from(clean).slice(0, max).join("");
}

function nonEmptyLines(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((line) => (typeof line === "string" ? line.trim() : ""))
    .filter(Boolean);
}

function hasId(item) {
  return typeof item?.id === "string" && item.id.trim() !== "";
}

function hasProjectText(item) {
  return hasId(item) && Boolean(String(item.name ?? "").trim() || nonEmptyLines(item.bullets).length);
}

function hasIssueText(item) {
  return (
    hasId(item) &&
    Boolean(String(item.title ?? "").trim() || String(item.text ?? "").trim())
  );
}

function hasNextText(item) {
  return (
    hasId(item) &&
    Boolean(String(item.projectName ?? "").trim() || nonEmptyLines(item.items).length)
  );
}

function assertObjects(list, label) {
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw fail(400, "ai.bad_request", `${label} 含有无法识别的条目。原文未改动。`);
    }
  }
}

function readMaterials(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw fail(400, "ai.bad_request", "请求体必须是 JSON 对象。原文未改动。");
  }
  const materials = body.materials;
  if (!materials || typeof materials !== "object" || Array.isArray(materials)) {
    throw fail(400, "ai.bad_request", "请求体需要 materials。原文未改动。");
  }
  if (!Array.isArray(materials.projects)) {
    throw fail(400, "ai.bad_request", "materials.projects 必须是数组。原文未改动。");
  }
  if (!Array.isArray(materials.nextWeek)) {
    throw fail(400, "ai.bad_request", "materials.nextWeek 必须是数组。原文未改动。");
  }
  const issues = materials.issues;
  if (
    !issues ||
    typeof issues !== "object" ||
    Array.isArray(issues) ||
    typeof issues.empty !== "boolean" ||
    !Array.isArray(issues.items)
  ) {
    throw fail(400, "ai.bad_request", "materials.issues 必须包含 empty 和 items。原文未改动。");
  }
  assertObjects(materials.projects, "projects");
  assertObjects(issues.items, "issues");
  assertObjects(materials.nextWeek, "nextWeek");
  return {
    projects: materials.projects,
    issues: { empty: issues.empty, items: issues.items },
    nextWeek: materials.nextWeek,
  };
}

function readScope(body) {
  const scope = body.scope == null || body.scope === "" ? "page" : body.scope;
  if (!SCOPES.has(scope)) {
    throw fail(
      400,
      "ai.bad_request",
      "scope 只能是 page、projects、issues、nextWeek、project、issueItem 或 nextWeekItem。原文未改动。",
    );
  }
  return scope;
}

function readTarget(body, materials, scope) {
  if (scope === "project") {
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) {
      throw fail(400, "ai.bad_request", "scope 为 project 时需要 projectId。原文未改动。");
    }
    if (!materials.projects.some((item) => item.id === projectId)) {
      throw fail(400, "ai.bad_request", "projectId 不在 materials.projects 中。原文未改动。");
    }
    return { projectId, itemId: "" };
  }
  if (scope === "issueItem" || scope === "nextWeekItem") {
    const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
    if (!itemId) {
      throw fail(400, "ai.bad_request", `scope 为 ${scope} 时需要 itemId。原文未改动。`);
    }
    const found =
      scope === "issueItem"
        ? materials.issues.items.some((item) => item.id === itemId)
        : materials.nextWeek.some((item) => item.id === itemId);
    if (!found) {
      throw fail(400, "ai.bad_request", "itemId 不在当前分区中。原文未改动。");
    }
    return { projectId: "", itemId };
  }
  return { projectId: "", itemId: "" };
}

function readConfig(env) {
  const apiKey = typeof env?.DEEPSEEK_API_KEY === "string" ? env.DEEPSEEK_API_KEY.trim() : "";
  if (!apiKey) {
    throw fail(
      503,
      AI_NOT_CONFIGURED,
      "未配置 DEEPSEEK_API_KEY。请在服务端 .env 或部署密钥中填写后重启。密钥只放服务端，不要写入前端或 VITE_ 变量。原文未改动。",
    );
  }
  const baseUrl = String(env.DEEPSEEK_API_BASE_URL || DEFAULT_BASE).trim() || DEFAULT_BASE;
  const model = String(env.DEEPSEEK_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
}

function readTimeout(deps, env) {
  const raw = deps.timeoutMs ?? env.DEEPSEEK_TIMEOUT_MS;
  if (raw == null || raw === "") return DEFAULT_TIMEOUT_MS;
  const timeout = Number(raw);
  if (!Number.isFinite(timeout) || timeout < 10 || timeout > 120_000) return DEFAULT_TIMEOUT_MS;
  return timeout;
}

function promptPayload(materials, scope, target) {
  const payload = {
    scope,
    limits: {
      title: AI_TITLE_MAX,
      bullet: AI_BULLET_MAX,
      progressBullets: AI_PROGRESS_BULLETS_MAX,
    },
  };
  if (scope === "project") {
    const item = materials.projects.find((row) => row.id === target.projectId);
    payload.projectId = target.projectId;
    payload.project = { id: target.projectId, bullets: nonEmptyLines(item?.bullets) };
    return payload;
  }
  if (scope === "issueItem") {
    const item = materials.issues.items.find((row) => row.id === target.itemId);
    payload.itemId = target.itemId;
    payload.issue = { id: target.itemId, text: String(item?.text ?? "") };
    return payload;
  }
  if (scope === "nextWeekItem") {
    const item = materials.nextWeek.find((row) => row.id === target.itemId);
    payload.itemId = target.itemId;
    payload.nextWeekItem = { id: target.itemId, items: nonEmptyLines(item?.items) };
    return payload;
  }
  if (scope === "page" || scope === "projects") {
    payload.projects = materials.projects.filter(hasProjectText).map((item) => ({
      id: item.id,
      name: String(item.name ?? ""),
      bullets: nonEmptyLines(item.bullets),
    }));
  }
  if ((scope === "page" || scope === "issues") && !materials.issues.empty) {
    payload.issues = materials.issues.items.filter(hasIssueText).map((item) => ({
      id: item.id,
      title: String(item.title ?? ""),
      text: String(item.text ?? ""),
    }));
  }
  if (scope === "page" || scope === "nextWeek") {
    payload.nextWeek = materials.nextWeek.filter(hasNextText).map((item) => ({
      id: item.id,
      projectName: String(item.projectName ?? ""),
      items: nonEmptyLines(item.items),
    }));
  }
  return payload;
}

function hasWork(payload) {
  if (payload.project) return nonEmptyLines(payload.project.bullets).length > 0;
  if (payload.issue) return Boolean(String(payload.issue.text ?? "").trim());
  if (payload.nextWeekItem) return nonEmptyLines(payload.nextWeekItem.items).length > 0;
  return (payload.projects?.length ?? 0) + (payload.issues?.length ?? 0) + (payload.nextWeek?.length ?? 0) > 0;
}

function chatCompletionsUrl(baseUrl) {
  const trimmed = String(baseUrl || DEFAULT_BASE).trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

function stripLineMeta(item) {
  const next = { ...item };
  delete next.statusLabel;
  delete next.owner;
  delete next.mergeLines;
  return next;
}

function mapById(list) {
  if (!Array.isArray(list)) return null;
  const map = new Map();
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (!hasId(item)) continue;
    map.set(item.id, item);
  }
  return map;
}

function asProposedList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.items)) return value.items;
  return null;
}

function rewriteTitle(original, proposed, secret) {
  if (!String(original ?? "").trim()) {
    const filled = clip(proposed, AI_TITLE_MAX, secret);
    return { ok: true, value: filled || original || "" };
  }
  const next = clip(proposed, AI_TITLE_MAX, secret);
  if (!next) return { ok: false, value: "" };
  return { ok: true, value: next };
}

function rewriteLines(original, proposed, cap, secret) {
  const source = nonEmptyLines(original);
  if (!source.length) return { ok: true, changed: false, value: Array.isArray(original) ? original : [] };
  if (!Array.isArray(proposed)) return { ok: false, changed: false, value: source };
  const limit = Math.min(cap, source.length);
  const next = proposed
    .map((line) => clip(line, AI_BULLET_MAX, secret))
    .filter(Boolean)
    .slice(0, limit);
  if (!next.length) return { ok: false, changed: false, value: source };
  const changed = next.length !== source.length || next.some((line, index) => line !== source[index]);
  return { ok: true, changed, value: next };
}

function rewriteProject(item, proposed, secret) {
  const name = rewriteTitle(item.name, proposed?.name, secret);
  if (!name.ok) return null;
  const bullets = rewriteLines(item.bullets, proposed?.bullets, AI_PROGRESS_BULLETS_MAX, secret);
  if (!bullets.ok) return null;
  const next = { ...item, name: name.value, bullets: bullets.value };
  return bullets.changed ? stripLineMeta(next) : next;
}

function rewriteIssue(item, proposed, secret) {
  const title = rewriteTitle(item.title, proposed?.title, secret);
  if (!title.ok) return null;
  const hadText = Boolean(String(item.text ?? "").trim());
  const text = hadText ? clip(proposed?.text, AI_BULLET_MAX, secret) : item.text ?? "";
  if (hadText && !text) return null;
  const bodyChanged = text !== (item.text ?? "");
  const next = { ...item, text };
  if (item.title !== undefined || String(item.title ?? "").trim()) next.title = title.value;
  else if (title.value) next.title = title.value;
  return bodyChanged ? stripLineMeta(next) : next;
}

function rewriteNext(item, proposed, secret) {
  const projectName = rewriteTitle(item.projectName, proposed?.projectName, secret);
  if (!projectName.ok) return null;
  const items = rewriteLines(item.items, proposed?.items, Number.POSITIVE_INFINITY, secret);
  if (!items.ok) return null;
  const next = { ...item, projectName: projectName.value, items: items.value };
  return items.changed ? stripLineMeta(next) : next;
}

function mergeList(original, proposed, needed, rewrite) {
  const required = original.filter(needed);
  if (!required.length) return original;
  const byId = mapById(asProposedList(proposed));
  if (!byId) return null;
  const next = [];
  for (const item of original) {
    if (!needed(item)) {
      next.push(item);
      continue;
    }
    const proposedItem = byId.get(item.id);
    if (!proposedItem) return null;
    const rewritten = rewrite(item, proposedItem);
    if (!rewritten) return null;
    next.push(rewritten);
  }
  return next;
}

function proposedById(parsed, keys, id) {
  for (const key of keys) {
    const source = parsed?.[key];
    if (source && typeof source === "object" && !Array.isArray(source) && source.id === id) return source;
    const list = asProposedList(source);
    if (!list) continue;
    const found = list.find((item) => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function mergeProjectBullets(materials, parsed, projectId, secret) {
  const project = materials.projects.find((item) => item.id === projectId);
  const proposed = proposedById(parsed, ["project", "projects"], projectId);
  if (!project || !proposed) return null;
  const bullets = rewriteLines(project.bullets, proposed.bullets, AI_PROGRESS_BULLETS_MAX, secret);
  if (!bullets.ok) return null;
  const projects = materials.projects.map((item) => {
    if (item.id !== projectId) return item;
    if (!bullets.changed) return item;
    return stripLineMeta({ ...item, bullets: bullets.value });
  });
  return { projects, issues: materials.issues, nextWeek: materials.nextWeek };
}

function mergeIssueItem(materials, parsed, itemId, secret) {
  const current = materials.issues.items.find((item) => item.id === itemId);
  const proposed = proposedById(parsed, ["issue", "issues"], itemId);
  if (!current || !proposed) return null;
  if (!String(current.text ?? "").trim()) return null;
  const text = clip(proposed.text, AI_BULLET_MAX, secret);
  if (!text) return null;
  const items = materials.issues.items.map((item) => {
    if (item.id !== itemId) return item;
    if (text === (item.text ?? "")) return item;
    return stripLineMeta({ ...item, text });
  });
  return {
    projects: materials.projects,
    issues: { empty: materials.issues.empty, items },
    nextWeek: materials.nextWeek,
  };
}

function mergeNextWeekItem(materials, parsed, itemId, secret) {
  const current = materials.nextWeek.find((item) => item.id === itemId);
  const proposed = proposedById(parsed, ["nextWeekItem", "nextWeek"], itemId);
  if (!current || !proposed) return null;
  const items = rewriteLines(current.items, proposed.items, Number.POSITIVE_INFINITY, secret);
  if (!items.ok) return null;
  const nextWeek = materials.nextWeek.map((item) => {
    if (item.id !== itemId) return item;
    if (!items.changed) return item;
    return stripLineMeta({ ...item, items: items.value });
  });
  return { projects: materials.projects, issues: materials.issues, nextWeek };
}

function mergeSummary(materials, parsed, scope, secret, target = { projectId: "", itemId: "" }) {
  if (scope === "project") return mergeProjectBullets(materials, parsed, target.projectId, secret);
  if (scope === "issueItem") return mergeIssueItem(materials, parsed, target.itemId, secret);
  if (scope === "nextWeekItem") return mergeNextWeekItem(materials, parsed, target.itemId, secret);
  const projects =
    scope === "page" || scope === "projects"
      ? mergeList(materials.projects, parsed.projects, hasProjectText, (item, proposed) =>
          rewriteProject(item, proposed, secret),
        )
      : materials.projects;
  if (!projects) return null;

  let issues = materials.issues;
  if (scope === "page" || scope === "issues") {
    if (!materials.issues.empty) {
      const items = mergeList(materials.issues.items, parsed.issues, hasIssueText, (item, proposed) =>
        rewriteIssue(item, proposed, secret),
      );
      if (!items) return null;
      issues = { empty: materials.issues.empty, items };
    }
  }

  const nextWeek =
    scope === "page" || scope === "nextWeek"
      ? mergeList(materials.nextWeek, parsed.nextWeek, hasNextText, (item, proposed) =>
          rewriteNext(item, proposed, secret),
        )
      : materials.nextWeek;
  if (!nextWeek) return null;
  return { projects, issues, nextWeek };
}

function parseModelJson(content) {
  let text = String(content ?? "").trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function callDeepseek(config, payload, fetchImpl, timeoutMs, systemPrompt = SYSTEM_PROMPT) {
  let response;
  try {
    response = await fetchImpl(chatCompletionsUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        max_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") {
      const error = fail(504, "ai.timeout", "AI 总结超时，原文未改动。请稍后重试。");
      error.upstreamStatus = 504;
      throw error;
    }
    const error = fail(502, "ai.upstream", "AI 服务暂时不可用，原文未改动。");
    throw error;
  }

  const status = Number(response?.status) || 0;
  if (status === 429) {
    const error = fail(429, "ai.rate_limited", "AI 总结请求过于频繁，原文未改动。请稍后再试。");
    error.upstreamStatus = 429;
    throw error;
  }
  if (!response || response.ok === false || status >= 400) {
    const error = fail(
      502,
      "ai.upstream",
      status === 401 || status === 403
        ? "AI 鉴权失败，原文未改动。请检查服务端 DEEPSEEK_API_KEY 是否有效。"
        : "AI 服务暂时不可用，原文未改动。",
    );
    error.upstreamStatus = status || 502;
    throw error;
  }

  let raw = "";
  try {
    raw = await response.text();
  } catch {
    const error = fail(502, "ai.upstream", "AI 服务暂时不可用，原文未改动。");
    error.upstreamStatus = status || 502;
    throw error;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw fail(502, "ai.empty", "AI 没有返回可用总结，原文未改动。");
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw fail(502, "ai.empty", "AI 没有返回可用总结，原文未改动。");
  }
  return config.apiKey ? content.split(config.apiKey).join("") : content;
}

/**
 * Rewrite titles and body bullets. Does not read or write the report store.
 * @returns {Promise<{ scope: string, materials: object }>}
 */
export async function summarizeMaterials(body, deps = {}) {
  const env = deps.env ?? process.env;
  const materials = readMaterials(body);
  const scope = readScope(body);
  const target = readTarget(body, materials, scope);
  const config = readConfig(env);
  const payload = promptPayload(materials, scope, target);
  if (!hasWork(payload)) {
    throw fail(422, "ai.empty", "没有可总结的标题或要点，原文未改动。");
  }
  const content = await callDeepseek(
    config,
    payload,
    deps.fetch ?? globalThis.fetch,
    readTimeout(deps, env),
    systemPromptFor(scope),
  );
  const parsed = parseModelJson(content);
  if (!parsed) throw fail(502, "ai.empty", "AI 没有返回可用总结，原文未改动。");
  const merged = mergeSummary(materials, parsed, scope, config.apiKey, target);
  if (!merged) throw fail(502, "ai.empty", "AI 没有返回可用总结，原文未改动。");
  return { scope, materials: merged };
}
