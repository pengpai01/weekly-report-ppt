import { useState } from "react";
import { aiErrorMessage, requestAiSummary } from "../lib/api";
import {
  applyAiText,
  buildAiDiff,
  commitAiPreview,
  type AiScope,
} from "../lib/aiSummarize";
import type { ZoneSnapshot } from "../lib/zoneMerge";

const SCOPES: { value: AiScope; label: string }[] = [
  { value: "page", label: "整页" },
  { value: "projects", label: "重要事项" },
  { value: "issues", label: "存在问题与建议" },
  { value: "nextWeek", label: "下周工作计划" },
];

function isMaterials(value: unknown): value is ZoneSnapshot {
  if (!value || typeof value !== "object") return false;
  const materials = value as ZoneSnapshot;
  return (
    Array.isArray(materials.projects) &&
    Array.isArray(materials.nextWeek) &&
    Boolean(materials.issues) &&
    Array.isArray(materials.issues.items) &&
    typeof materials.issues.empty === "boolean"
  );
}

/**
 * One-click summarize for the materials page.
 * The preview stays in component state. Cancel, undo, and any API failure
 * do not call onApply, so the draft and the database stay unchanged.
 */
export function AiSummarizeControl({
  value,
  onApply,
}: {
  value: ZoneSnapshot;
  onApply: (next: ZoneSnapshot) => void;
}) {
  const [scope, setScope] = useState<AiScope>("page");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ZoneSnapshot | null>(null);
  const [previewScope, setPreviewScope] = useState<AiScope>("page");

  const discard = () => {
    setPreview(null);
  };

  const run = async () => {
    setError("");
    setPreview(null);
    setBusy(true);
    try {
      const result = await requestAiSummary(value, scope);
      if (!isMaterials(result?.materials)) {
        setError("AI 没有返回可用总结，原文未改动。");
        return;
      }
      const drafted = applyAiText(value, result.materials, scope);
      if (!commitAiPreview(true, value, result.materials, scope)) {
        setError("总结结果与原文一致，原文未改动。");
        return;
      }
      setPreviewScope(scope);
      setPreview(drafted);
    } catch (err) {
      setPreview(null);
      setError(aiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    const next = commitAiPreview(true, value, preview, previewScope);
    setPreview(null);
    if (!next) return;
    onApply(next);
  };

  const drafted = preview;
  const diff = drafted ? buildAiDiff(value, drafted) : [];

  return (
    <div className="ai-summarize">
      <p className="hint ai-hint">
        总结并压缩标题与要点。默认整页，也可只处理一个分区。确认前不会写入草稿。
      </p>
      <div className="inline-actions">
        <label className="ai-scope-label">
          总结范围
          <select
            className="ai-scope"
            aria-label="总结范围"
            value={scope}
            disabled={busy}
            onChange={(event) => setScope(event.target.value as AiScope)}
          >
            {SCOPES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-dark btn-sm"
          disabled={busy}
          title="总结标题和要点。确认前不会写入草稿。"
          onClick={() => void run()}
        >
          {busy ? "正在总结…" : "一键总结"}
        </button>
      </div>
      {error ? (
        <div className="error ai-error" role="alert">
          {error}
        </div>
      ) : null}

      {drafted ? (
        <div className="overlay" onClick={discard}>
          <div
            className="modal ai-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-summary-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="ai-summary-title">一键总结预览</h3>
            <p className="hint">
              标题不超过 24 字，要点不超过 60 字，每个项目的进展要点不超过 5 条。撤销或取消都不会改动原文，也不会写入数据库。
            </p>
            <div className="ai-diff">
              {diff.map((entry) => (
                <article key={entry.key} className="ai-diff-item">
                  <div className="ai-diff-kicker">
                    {entry.zone} · {entry.heading}
                  </div>
                  {entry.fields.map((field) => (
                    <div key={field.label} className="ai-diff-line">
                      <div className="ai-diff-label">{field.label}</div>
                      <div>
                        <span className="ai-diff-tag">原文</span>
                        <span className="ai-before">{field.before || "（空）"}</span>
                      </div>
                      <div>
                        <span className="ai-diff-tag">总结</span>
                        <span className="ai-after">{field.after || "（空）"}</span>
                      </div>
                    </div>
                  ))}
                </article>
              ))}
            </div>
            <div className="footer-bar">
              <button type="button" className="btn btn-ghost" onClick={discard}>
                撤销
              </button>
              <div className="inline-actions">
                <button type="button" className="btn btn-ghost" onClick={discard}>
                  取消
                </button>
                <button type="button" className="btn btn-primary" onClick={confirm}>
                  确认写入
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
