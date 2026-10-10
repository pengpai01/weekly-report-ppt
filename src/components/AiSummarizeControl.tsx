import { useId, useRef, useState } from "react";
import { aiErrorMessage, requestAiSummary } from "../lib/api";
import { applyAiText, buildAiDiff, commitAiPreview, type AiScope } from "../lib/aiSummarize";
import type { ZoneSnapshot } from "../lib/zoneMerge";
import type { IssueItem, NextWeekRow, Project } from "../types";

type PreviewState = {
  zone: string;
  heading: string;
  before: string;
  after: string;
  apply: () => void;
};

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
 * Confirm is the only path that calls onApply. Cancel, undo, and any API
 * failure leave the draft alone. The button disables itself while the request
 * is in flight.
 */
function SummarizeButton({
  ariaLabel,
  hint,
  previewTitle,
  run,
}: {
  ariaLabel: string;
  hint: string;
  previewTitle: string;
  run: () => Promise<PreviewState | "same" | "empty">;
}) {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const running = useRef(false);

  const discard = () => setPreview(null);

  const start = async () => {
    if (running.current) return;
    running.current = true;
    setError("");
    setPreview(null);
    setBusy(true);
    try {
      const next = await run();
      if (next === "empty") {
        setError("AI 没有返回可用总结，原文未改动。");
        return;
      }
      if (next === "same") {
        setError("总结结果与原文一致，原文未改动。");
        return;
      }
      setPreview(next);
    } catch (err) {
      setPreview(null);
      setError(aiErrorMessage(err));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const confirm = () => {
    const pending = preview;
    setPreview(null);
    pending?.apply();
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-dark btn-sm project-summarize"
        disabled={busy}
        aria-busy={busy}
        aria-label={ariaLabel}
        title={hint}
        onClick={() => void start()}
      >
        {busy ? "正在总结…" : "一键总结"}
      </button>
      {error ? (
        <div className="error ai-error ai-row-error" role="alert">
          {error}
        </div>
      ) : null}
      {preview ? (
        <div className="overlay" onClick={discard}>
          <div
            className="modal ai-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id={titleId}>{previewTitle}</h3>
            <p className="hint">
              {hint} 撤销或取消都不会改动原文，也不会写入数据库。
            </p>
            <div className="ai-diff">
              <article className="ai-diff-item">
                <div className="ai-diff-kicker">
                  {preview.zone} · {preview.heading}
                </div>
                <div className="ai-diff-line">
                  <div className="ai-diff-label">要点</div>
                  <div>
                    <span className="ai-diff-tag">原文</span>
                    <span className="ai-before">{preview.before || "（空）"}</span>
                  </div>
                  <div>
                    <span className="ai-diff-tag">总结</span>
                    <span className="ai-after">{preview.after || "（空）"}</span>
                  </div>
                </div>
              </article>
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
    </>
  );
}

function changedField(before: ZoneSnapshot, after: ZoneSnapshot, scope: AiScope, targetId: string) {
  const drafted = applyAiText(before, after, scope, targetId);
  if (!commitAiPreview(true, before, after, scope, targetId)) return null;
  const diff = buildAiDiff(before, drafted);
  const field = diff.flatMap((entry) => entry.fields).find((item) => item.label === "要点");
  if (!field) return null;
  return { drafted, before: field.before, after: field.after, heading: diff[0]?.heading ?? "" };
}

async function requestScoped(
  materials: ZoneSnapshot,
  scope: AiScope,
  target: { projectId?: string; itemId?: string } = {},
) {
  const result = await requestAiSummary(materials, scope, target);
  if (!isMaterials(result?.materials)) return null;
  return result.materials;
}

export function ProjectAiButton({
  project,
  onApply,
}: {
  project: Project;
  onApply: (projectId: string, bullets: string[]) => void;
}) {
  const displayName = project.name.trim() || "未命名项目";
  return (
    <SummarizeButton
      ariaLabel={`一键总结 ${displayName}`}
      previewTitle="一键总结预览"
      hint="只覆盖这个项目的要点。标题、其他项目、问题和下周计划都不会改。确认前不会写入草稿。"
      run={async () => {
        const current: ZoneSnapshot = {
          projects: [project],
          issues: { empty: true, items: [] },
          nextWeek: [],
        };
        const proposed = await requestScoped(current, "project", { projectId: project.id });
        if (!proposed) return "empty";
        const changed = changedField(current, proposed, "project", project.id);
        if (!changed) return "same";
        return {
          zone: "重要事项",
          heading: changed.heading || displayName,
          before: changed.before,
          after: changed.after,
          apply: () => onApply(project.id, changed.drafted.projects[0].bullets),
        };
      }}
    />
  );
}

export function IssueAiButton({
  item,
  onApply,
}: {
  item: IssueItem;
  onApply: (itemId: string, text: string) => void;
}) {
  const displayName = item.text.trim() || "未命名问题";
  return (
    <SummarizeButton
      ariaLabel={`一键总结 ${displayName}`}
      previewTitle="一键总结预览"
      hint="只覆盖这一条问题的正文。标题、其他问题、重要事项和下周计划都不会改。确认前不会写入草稿。"
      run={async () => {
        const current: ZoneSnapshot = {
          projects: [],
          issues: { empty: false, items: [item] },
          nextWeek: [],
        };
        const proposed = await requestScoped(current, "issueItem", { itemId: item.id });
        if (!proposed) return "empty";
        const changed = changedField(current, proposed, "issueItem", item.id);
        if (!changed) return "same";
        return {
          zone: "存在问题与建议",
          heading: changed.heading || displayName,
          before: changed.before,
          after: changed.after,
          apply: () => onApply(item.id, changed.drafted.issues.items[0].text),
        };
      }}
    />
  );
}

export function NextWeekAiButton({
  item,
  onApply,
}: {
  item: NextWeekRow;
  onApply: (itemId: string, items: string[]) => void;
}) {
  const displayName = item.projectName.trim() || "未命名计划";
  return (
    <SummarizeButton
      ariaLabel={`一键总结 ${displayName}`}
      previewTitle="一键总结预览"
      hint="只覆盖这一行下周计划的要点。项目名、其他计划、重要事项和问题都不会改。确认前不会写入草稿。"
      run={async () => {
        const current: ZoneSnapshot = {
          projects: [],
          issues: { empty: true, items: [] },
          nextWeek: [item],
        };
        const proposed = await requestScoped(current, "nextWeekItem", { itemId: item.id });
        if (!proposed) return "empty";
        const changed = changedField(current, proposed, "nextWeekItem", item.id);
        if (!changed) return "same";
        return {
          zone: "下周工作计划",
          heading: changed.heading || displayName,
          before: changed.before,
          after: changed.after,
        apply: () => onApply(item.id, changed.drafted.nextWeek[0].items),
      };
    }}
  />
);
}

export function IssuePartitionAiButton({
  tag,
  items,
  onApply,
}: {
  tag: string;
  items: IssueItem[];
  onApply: (updates: { id: string; text: string }[]) => void;
}) {
  return (
    <SummarizeButton
      ariaLabel={`一键总结问题分区 ${tag}`}
      previewTitle="一键总结预览"
      hint="只覆盖这个问题分区里各条正文。分区名、其他分区、重要事项和下周计划都不会改。确认前不会写入草稿。"
      run={async () => {
        const current: ZoneSnapshot = {
          projects: [],
          issues: { empty: false, items },
          nextWeek: [],
        };
        const proposed = await requestScoped(current, "issuePartition");
        if (!proposed) return "empty";
        if (!commitAiPreview(true, current, proposed, "issuePartition")) return "same";
        const drafted = applyAiText(current, proposed, "issuePartition");
        return {
          zone: "存在问题与建议",
          heading: tag,
          before: items.map((item) => item.text).join("\n"),
          after: drafted.issues.items.map((item) => item.text).join("\n"),
          apply: () => onApply(drafted.issues.items.map((item) => ({ id: item.id, text: item.text }))),
        };
      }}
    />
  );
}

export function NextWeekPartitionAiButton({
  tag,
  items,
  onApply,
}: {
  tag: string;
  items: NextWeekRow[];
  onApply: (updates: { id: string; items: string[] }[]) => void;
}) {
  return (
    <SummarizeButton
      ariaLabel={`一键总结下周分区 ${tag}`}
      previewTitle="一键总结预览"
      hint="只覆盖这个下周分区里各行要点。分区名、项目名、其他分区、重要事项和问题都不会改。确认前不会写入草稿。"
      run={async () => {
        const current: ZoneSnapshot = {
          projects: [],
          issues: { empty: true, items: [] },
          nextWeek: items,
        };
        const proposed = await requestScoped(current, "nextWeekPartition");
        if (!proposed) return "empty";
        if (!commitAiPreview(true, current, proposed, "nextWeekPartition")) return "same";
        const drafted = applyAiText(current, proposed, "nextWeekPartition");
        return {
          zone: "下周工作计划",
          heading: tag,
          before: items.map((item) => item.items.join("\n")).join("\n"),
          after: drafted.nextWeek.map((item) => item.items.join("\n")).join("\n"),
          apply: () => onApply(drafted.nextWeek.map((item) => ({ id: item.id, items: item.items }))),
        };
      }}
    />
  );
}
