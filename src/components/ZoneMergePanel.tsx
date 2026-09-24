import { useEffect, useState } from "react";
import { newIssue, newPlanRow, newProject } from "../lib/importZones";
import {
  EMPTY_SELECTION,
  ZONE_LABEL,
  canMergeSelection,
  clearLineMeta,
  mergeZoneItems,
  setPrimary,
  toggleSelection,
  type MergeZone,
  type ZoneSelection,
  type ZoneSnapshot,
} from "../lib/zoneMerge";
import type { ProjectStatus } from "../types";
import { PROJECT_STATUS_LABEL } from "../types";

export function AutoMergeToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="auto-merge-toggle" title="入库前关闭可重新预览；确认入库后不回退">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      按模块自动归并
    </label>
  );
}

export function ZoneMergePanel({
  value,
  onChange,
  resetKey = "",
  scrollable = false,
}: {
  value: ZoneSnapshot;
  onChange: (next: ZoneSnapshot) => void;
  resetKey?: string;
  scrollable?: boolean;
}) {
  const [selection, setSelection] = useState<ZoneSelection>(EMPTY_SELECTION);
  const [undo, setUndo] = useState<ZoneSnapshot[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    setSelection(EMPTY_SELECTION);
    setUndo([]);
    setError("");
  }, [resetKey]);

  const toggle = (zone: MergeZone, id: string) => {
    const result = toggleSelection(selection, zone, id);
    setError(result.error ?? "");
    setSelection(result.selection);
  };

  const mergeSelected = () => {
    if (!selection.zone || !canMergeSelection(selection)) {
      setError("请在同一分区至少选择 2 条");
      return;
    }
    try {
      const next = mergeZoneItems(value, selection.zone, selection.ids, selection.primaryId);
      setUndo((stack) => [...stack, value]);
      setSelection(EMPTY_SELECTION);
      setError("");
      onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法合并");
    }
  };

  const undoMerge = () => {
    const previous = undo[undo.length - 1];
    if (!previous) return;
    setUndo((stack) => stack.slice(0, -1));
    setSelection(EMPTY_SELECTION);
    setError("");
    onChange(previous);
  };

  const zoneName = selection.zone ? ZONE_LABEL[selection.zone] : "";
  const statusText = error
    ? error
    : selection.ids.length >= 2
      ? `已选 ${selection.ids.length} 条（${zoneName}）。标题取较长名称，等长取主项。`
      : "只能合并同一分区。至少选择 2 条后点「合并」。标题取较长名称，等长取主项（默认先勾选）。正文按勾选顺序拼接，每行前加 [状态·负责人]。入库前可撤销本次合并。";

  const selected = new Set(selection.ids);
  const activeZone = selection.zone;

  return (
    <div className={`merge-panel${scrollable ? " merge-panel-scroll" : ""}`}>
      <div className="merge-toolbar">
        <p className={error ? "error merge-status" : "hint merge-status"}>{statusText}</p>
        <div className="inline-actions">
          <button className="btn btn-primary btn-sm" disabled={!canMergeSelection(selection)} onClick={mergeSelected}>
            合并
          </button>
          <button
            className="btn btn-ghost btn-sm"
            disabled={undo.length === 0}
            title="恢复本次合并前的条目。确认入库后不可撤销。"
            onClick={undoMerge}
          >
            撤销本次合并
          </button>
        </div>
      </div>

      <section className="merge-zone" id="merge-zone-projects">
        <div className="merge-zone-head">
          <h3>{ZONE_LABEL.projects}</h3>
          <button className="btn btn-ghost btn-sm" onClick={() => onChange({ ...value, projects: [...value.projects, newProject()] })}>
            添加项目
          </button>
        </div>
        {value.projects.length === 0 ? (
          <div className="panel empty" style={{ boxShadow: "none" }}>暂无重要事项。</div>
        ) : (
          <div className="merge-list">
            {value.projects.map((project, index) => (
              <article
                key={project.id}
                className={`project-card merge-item${activeZone === "projects" && selected.has(project.id) ? " selected" : ""}`}
              >
                <label className="merge-check">
                  <input
                    type="checkbox"
                    checked={activeZone === "projects" && selected.has(project.id)}
                    aria-label={`选择重要事项 ${project.name || index + 1}`}
                    onChange={() => toggle("projects", project.id)}
                  />
                </label>
                <div>
                  <div className="project-head">
                    <PrimaryMark
                      selected={activeZone === "projects" && selected.has(project.id)}
                      primary={activeZone === "projects" && selection.primaryId === project.id}
                      onSetPrimary={() => setSelection(setPrimary(selection, project.id))}
                    />
                    <span className="drag-handle">{index + 1}</span>
                    <input
                      className="text-input"
                      placeholder="项目名称 *"
                      value={project.name}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          projects: value.projects.map((item) =>
                            item.id === project.id ? { ...item, name: event.target.value } : item,
                          ),
                        })
                      }
                    />
                    <select
                      value={project.status ?? ""}
                      aria-label="项目标签"
                      onChange={(event) =>
                        onChange({
                          ...value,
                          projects: value.projects.map((item) =>
                            item.id === project.id
                              ? { ...item, status: (event.target.value || undefined) as ProjectStatus | undefined }
                              : item,
                          ),
                        })
                      }
                    >
                      <option value="">标签（可选）</option>
                      {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((key) => (
                        <option key={key} value={key}>{PROJECT_STATUS_LABEL[key]}</option>
                      ))}
                    </select>
                    <button className="btn btn-ghost btn-sm" onClick={() => moveProject(value, index, -1, onChange)}>上移</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => moveProject(value, index, 1, onChange)}>下移</button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => onChange({ ...value, projects: value.projects.filter((item) => item.id !== project.id) })}
                    >
                      删除
                    </button>
                  </div>
                  {project.bullets.map((bullet, bulletIndex) => (
                    <div className="bullet-row" key={`${project.id}-${bulletIndex}`}>
                      <textarea
                        className="text-input"
                        placeholder={`进展要点 ${bulletIndex + 1}`}
                        value={bullet}
                        onChange={(event) =>
                          onChange({
                            ...value,
                            projects: value.projects.map((item) =>
                              item.id === project.id
                                ? clearLineMeta({
                                    ...item,
                                    bullets: item.bullets.map((line, lineIndex) =>
                                      lineIndex === bulletIndex ? event.target.value : line,
                                    ),
                                  })
                                : item,
                            ),
                          })
                        }
                      />
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          onChange({
                            ...value,
                            projects: value.projects.map((item) =>
                              item.id === project.id
                                ? clearLineMeta({
                                    ...item,
                                    bullets: item.bullets.filter((_, lineIndex) => lineIndex !== bulletIndex),
                                  })
                                : item,
                            ),
                          })
                        }
                      >
                        删除
                      </button>
                    </div>
                  ))}
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      onChange({
                        ...value,
                        projects: value.projects.map((item) =>
                          item.id === project.id ? clearLineMeta({ ...item, bullets: [...item.bullets, ""] }) : item,
                        ),
                      })
                    }
                  >
                    添加要点
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="merge-zone" id="merge-zone-issues">
        <div className="merge-zone-head">
          <h3>{ZONE_LABEL.issues}</h3>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() =>
              onChange({
                ...value,
                issues: { empty: false, items: [...value.issues.items, newIssue()] },
              })
            }
          >
            添加一条
          </button>
        </div>
        <label className="field" style={{ marginBottom: 12 }}>
          <span>
            <input
              type="checkbox"
              checked={value.issues.empty}
              onChange={(event) => {
                if (event.target.checked && selection.zone === "issues") setSelection(EMPTY_SELECTION);
                onChange({ ...value, issues: { ...value.issues, empty: event.target.checked } });
              }}
            />{" "}
            本期无（生成 N/A 页）
          </span>
        </label>
        {value.issues.empty ? null : value.issues.items.length === 0 ? (
          <div className="panel empty" style={{ boxShadow: "none" }}>暂无问题或建议。</div>
        ) : (
          <div className="merge-list">
            {value.issues.items.map((item, index) => (
              <article
                key={item.id}
                className={`merge-item${activeZone === "issues" && selected.has(item.id) ? " selected" : ""}`}
              >
                <label className="merge-check">
                  <input
                    type="checkbox"
                    checked={activeZone === "issues" && selected.has(item.id)}
                    aria-label={`选择问题 ${index + 1}`}
                    onChange={() => toggle("issues", item.id)}
                  />
                </label>
                <div>
                  <div className="project-head">
                    <PrimaryMark
                      selected={activeZone === "issues" && selected.has(item.id)}
                      primary={activeZone === "issues" && selection.primaryId === item.id}
                      onSetPrimary={() => setSelection(setPrimary(selection, item.id))}
                    />
                    <input
                      className="text-input"
                      placeholder="标题"
                      aria-label={`问题标题 ${index + 1}`}
                      value={item.title ?? ""}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          issues: {
                            ...value.issues,
                            items: value.issues.items.map((row) =>
                              row.id === item.id ? { ...row, title: event.target.value } : row,
                            ),
                          },
                        })
                      }
                    />
                  </div>
                <div className="bullet-row">
                  <textarea
                    className="text-input"
                    placeholder="问题或建议"
                    value={item.text}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        issues: {
                          ...value.issues,
                          items: value.issues.items.map((row) =>
                            row.id === item.id ? clearLineMeta({ ...row, text: event.target.value }) : row,
                          ),
                        },
                      })
                    }
                  />
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() =>
                      onChange({
                        ...value,
                        issues: { ...value.issues, items: value.issues.items.filter((row) => row.id !== item.id) },
                      })
                    }
                  >
                    删除
                  </button>
                </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="merge-zone" id="merge-zone-nextWeek">
        <div className="merge-zone-head">
          <h3>{ZONE_LABEL.nextWeek}</h3>
          <div className="inline-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => carryProjectNames(value, onChange)}>
              从重要事项带入项目名
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => onChange({ ...value, nextWeek: [...value.nextWeek, newPlanRow()] })}
            >
              添加一行
            </button>
          </div>
        </div>
        {value.nextWeek.length === 0 ? (
          <div className="panel empty" style={{ boxShadow: "none" }}>暂无下周计划。</div>
        ) : (
          <div className="merge-list">
            {value.nextWeek.map((row, index) => (
              <article
                key={row.id}
                className={`merge-item${activeZone === "nextWeek" && selected.has(row.id) ? " selected" : ""}`}
              >
                <label className="merge-check">
                  <input
                    type="checkbox"
                    checked={activeZone === "nextWeek" && selected.has(row.id)}
                    aria-label={`选择下周计划 ${row.projectName || index + 1}`}
                    onChange={() => toggle("nextWeek", row.id)}
                  />
                </label>
                <div>
                  <div className="project-head">
                    <PrimaryMark
                      selected={activeZone === "nextWeek" && selected.has(row.id)}
                      primary={activeZone === "nextWeek" && selection.primaryId === row.id}
                      onSetPrimary={() => setSelection(setPrimary(selection, row.id))}
                    />
                    <input
                      className="text-input"
                      placeholder="项目"
                      value={row.projectName}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          nextWeek: value.nextWeek.map((item) =>
                            item.id === row.id ? { ...item, projectName: event.target.value } : item,
                          ),
                        })
                      }
                    />
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => onChange({ ...value, nextWeek: value.nextWeek.filter((item) => item.id !== row.id) })}
                    >
                      删除
                    </button>
                  </div>
                  <textarea
                    className="text-input"
                    placeholder="工作内容（每行一条）"
                    value={row.items.join("\n")}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        nextWeek: value.nextWeek.map((item) =>
                          item.id === row.id
                            ? clearLineMeta({ ...item, items: event.target.value.split("\n") })
                            : item,
                        ),
                      })
                    }
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PrimaryMark({
  selected,
  primary,
  onSetPrimary,
}: {
  selected: boolean;
  primary: boolean;
  onSetPrimary: () => void;
}) {
  if (!selected) return null;
  if (primary) return <span className="merge-primary">主项</span>;
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={onSetPrimary}>
      设为主项
    </button>
  );
}

function moveProject(
  value: ZoneSnapshot,
  index: number,
  dir: -1 | 1,
  onChange: (next: ZoneSnapshot) => void,
) {
  const next = [...value.projects];
  const target = index + dir;
  if (target < 0 || target >= next.length) return;
  [next[index], next[target]] = [next[target], next[index]];
  onChange({ ...value, projects: next });
}

function carryProjectNames(value: ZoneSnapshot, onChange: (next: ZoneSnapshot) => void) {
  const existing = new Set(value.nextWeek.map((row) => row.projectName.trim()));
  const added = value.projects
    .filter((project) => project.name.trim() && !existing.has(project.name.trim()))
    .map((project) => newPlanRow(project.name.trim()));
  if (!added.length) return;
  onChange({ ...value, nextWeek: [...value.nextWeek, ...added] });
}
