import { useEffect, useRef, useState, type ReactNode } from "react";
import { IssueAiButton, NextWeekAiButton, ProjectAiButton } from "./AiSummarizeControl";
import {
  applyNextWeekProjectName,
  groupByDisplayTag,
  issueDisplayTag,
  nextWeekDisplayTag,
} from "../lib/bracketTag";
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

/** Second confirm: the project and every child entry go together. Undo is the merge bar. */
export function projectDeleteConfirmCopy(name: string): string {
  const displayName = name.trim() || "未命名项目";
  return `确定删除项目「${displayName}」？删除该项目会同时删除其下全部要点条目。可使用上方「撤销本次合并」恢复整个项目及其全部条目。`;
}

/** Second confirm for one child row. Item deletes stay off the merge undo stack. */
export function itemDeleteConfirmCopy(kind: "bullet" | "issue" | "nextWeek", label: string): string {
  const display = label.trim().replace(/\s+/g, " ");
  const short = display.length > 40 ? `${display.slice(0, 40)}…` : display;
  const quoted = short ? `「${short}」` : "";
  if (kind === "bullet") {
    return `确定删除要点${quoted}？仅删除这一条要点，不会删除整个项目。`;
  }
  if (kind === "issue") {
    return `确定删除问题或建议${quoted}？仅删除这一条，不会删除整个项目。`;
  }
  return `确定删除下周计划${quoted}？仅删除这一行，不会删除整个项目。`;
}

type PendingItemDelete = { kind: "issue"; id: string } | { kind: "nextWeek"; id: string };

/** One line is one bullet. Blank lines are dropped. An empty field is `[]`. */
export function bulletsFromLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim() !== "");
}

function sameBullets(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

/**
 * Remove one project from the snapshot.
 * `projects: []` stays empty — callers must not insert a shell project.
 * Only that project id leaves the selection and the collapse set.
 */
export function applyProjectDelete(
  value: ZoneSnapshot,
  selection: ZoneSelection,
  openProjectIds: ReadonlySet<string>,
  projectId: string,
): { value: ZoneSnapshot; selection: ZoneSelection; openProjectIds: ReadonlySet<string> } {
  const nextSelection =
    selection.zone === "projects" && selection.ids.includes(projectId)
      ? toggleSelection(selection, "projects", projectId).selection
      : selection;
  const nextOpen = new Set(openProjectIds);
  nextOpen.delete(projectId);
  return {
    value: { ...value, projects: value.projects.filter((item) => item.id !== projectId) },
    selection: nextSelection,
    openProjectIds: nextOpen,
  };
}

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
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingItemDelete, setPendingItemDelete] = useState<PendingItemDelete | null>(null);
  // Session-only. Not written to the draft, localStorage, or the URL.
  const [openProjectIds, setOpenProjectIds] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsedIssueTags, setCollapsedIssueTags] = useState<ReadonlySet<string>>(() => new Set());
  const seededNextWeekIds = useRef(new Set<string>());

  useEffect(() => {
    setSelection(EMPTY_SELECTION);
    setUndo([]);
    setError("");
    setPendingDeleteId(null);
    setPendingItemDelete(null);
    setOpenProjectIds(new Set());
    setCollapsedIssueTags(new Set());
    seededNextWeekIds.current.clear();
  }, [resetKey]);

  useEffect(() => {
    let changed = false;
    const nextWeek = value.nextWeek.map((row) => {
      if (seededNextWeekIds.current.has(row.id)) return row;
      seededNextWeekIds.current.add(row.id);
      const filled = applyNextWeekProjectName(row, "load");
      if (filled !== row) changed = true;
      return filled;
    });
    if (changed) onChange({ ...value, nextWeek });
  }, [value, onChange]);

  useEffect(() => {
    if (pendingDeleteId && !value.projects.some((item) => item.id === pendingDeleteId)) {
      setPendingDeleteId(null);
    }
  }, [pendingDeleteId, value.projects]);

  const toggleProjectOpen = (id: string) => {
    setOpenProjectIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleIssueTag = (tag: string) => {
    setCollapsedIssueTags((current) => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

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
      setPendingDeleteId(null);
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
    setPendingDeleteId(null);
    setError("");
    onChange(previous);
  };

  const commitProjectDelete = (projectId: string) => {
    if (!value.projects.some((item) => item.id === projectId)) {
      setPendingDeleteId(null);
      return;
    }
    const next = applyProjectDelete(value, selection, openProjectIds, projectId);
    setUndo((stack) => [...stack, value]);
    setSelection(next.selection);
    setOpenProjectIds(next.openProjectIds);
    setPendingDeleteId(null);
    setError("");
    onChange(next.value);
  };

  const applyProjectSummary = (projectId: string, bullets: string[]) => {
    const current = value.projects.find((item) => item.id === projectId);
    if (!current || sameBullets(current.bullets, bullets)) return;
    onChange({
      ...value,
      projects: value.projects.map((item) =>
        item.id === projectId ? clearLineMeta({ ...item, bullets }) : item,
      ),
    });
  };

  const applyIssueSummary = (itemId: string, text: string) => {
    const current = value.issues.items.find((item) => item.id === itemId);
    if (!current || current.text === text) return;
    onChange({
      ...value,
      issues: {
        ...value.issues,
        items: value.issues.items.map((item) =>
          item.id === itemId ? clearLineMeta({ ...item, text }) : item,
        ),
      },
    });
  };

  const applyNextSummary = (itemId: string, items: string[]) => {
    const current = value.nextWeek.find((item) => item.id === itemId);
    if (!current || sameBullets(current.items, items)) return;
    onChange({
      ...value,
      nextWeek: value.nextWeek.map((item) =>
        item.id === itemId ? clearLineMeta({ ...item, items }) : item,
      ),
    });
  };

  const commitItemDelete = () => {
    const pending = pendingItemDelete;
    setPendingItemDelete(null);
    if (!pending) return;
    if (pending.kind === "issue") {
      if (!value.issues.items.some((row) => row.id === pending.id)) return;
      onChange({
        ...value,
        issues: { ...value.issues, items: value.issues.items.filter((row) => row.id !== pending.id) },
      });
      return;
    }
    if (!value.nextWeek.some((item) => item.id === pending.id)) return;
    onChange({ ...value, nextWeek: value.nextWeek.filter((item) => item.id !== pending.id) });
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
            {value.projects.map((project, index) => {
              const open = openProjectIds.has(project.id);
              const projectChecked = activeZone === "projects" && selected.has(project.id);
              const displayName = project.name.trim() || "未命名项目";
              const itemCount = project.bullets.length;
              return (
              <article
                key={project.id}
                className={`project-card merge-item${projectChecked ? " selected" : ""}${open ? "" : " is-collapsed"}`}
              >
                <label className="merge-check">
                  <input
                    type="checkbox"
                    checked={projectChecked}
                    aria-label={`选择重要事项 ${project.name || index + 1}`}
                    onChange={() => toggle("projects", project.id)}
                  />
                </label>
                <div>
                  <div className="project-head">
                    <PrimaryMark
                      selected={projectChecked}
                      primary={activeZone === "projects" && selection.primaryId === project.id}
                      onSetPrimary={() => setSelection(setPrimary(selection, project.id))}
                    />
                    <span className="drag-handle">{index + 1}</span>
                    {open ? (
                      <>
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
                      </>
                    ) : (
                      <>
                        <span className="project-collapse-name">{displayName}</span>
                        <span className="project-collapse-count">{itemCount} 条</span>
                      </>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => moveProject(value, index, -1, onChange)}>上移</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => moveProject(value, index, 1, onChange)}>下移</button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      aria-expanded={open}
                      aria-label={`${open ? "收起" : "展开"} ${displayName}`}
                      onClick={() => toggleProjectOpen(project.id)}
                    >
                      {open ? "收起" : "展开"}
                    </button>
                    <ProjectAiButton project={project} onApply={applyProjectSummary} />
                    <RowMenu label={`更多 ${displayName}`}>
                      <button
                        type="button"
                        role="menuitem"
                        className="row-menu-item"
                        onClick={() => setPendingDeleteId(project.id)}
                      >
                        删除项目
                      </button>
                    </RowMenu>
                  </div>
                  {pendingDeleteId === project.id ? (
                    <div className="project-delete-confirm" role="alertdialog" aria-label="确认删除项目">
                      <p>{projectDeleteConfirmCopy(project.name)}</p>
                      <div className="inline-actions">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPendingDeleteId(null)}>
                          取消
                        </button>
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => commitProjectDelete(project.id)}>
                          确定删除
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {open ? (
                    <ProjectBulletsEditor
                      label={`进展要点 ${displayName}`}
                      bullets={project.bullets}
                      onCommit={(bullets) =>
                        onChange({
                          ...value,
                          projects: value.projects.map((item) =>
                            item.id === project.id ? clearLineMeta({ ...item, bullets }) : item,
                          ),
                        })
                      }
                    />
                  ) : null}
                </div>
              </article>
              );
            })}
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
          <div className="zone-tag-groups">
            {groupByDisplayTag(value.issues.items, issueDisplayTag).map((group) => {
              const open = !collapsedIssueTags.has(group.tag);
              return (
              <section
                key={group.tag}
                className={`issue-partition${open ? "" : " is-collapsed"}`}
                aria-label={`问题分组 ${group.tag}`}
              >
                <div className="issue-partition-head">
                  <h4 className="issue-partition-name">{group.tag}</h4>
                  <span className="issue-partition-count">{group.items.length} 条</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-expanded={open}
                    aria-label={`${open ? "收起" : "展开"}问题分组 ${group.tag}`}
                    onClick={() => toggleIssueTag(group.tag)}
                  >
                    {open ? "收起" : "展开"}
                  </button>
                </div>
                {open ? (
                <div className="issue-partition-body merge-list">
            {group.items.map((item) => {
              const index = value.issues.items.findIndex((row) => row.id === item.id);
              return (
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
                    <IssueAiButton item={item} onApply={applyIssueSummary} />
                  </div>
                <div className="bullet-row">
                  <textarea
                    className="text-input"
                    placeholder="问题或建议"
                    aria-label={`问题内容 ${index + 1}`}
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
                  <RowMenu label={`更多 问题 ${index + 1}`}>
                    <button
                      type="button"
                      role="menuitem"
                      className="row-menu-item"
                      onClick={() => setPendingItemDelete({ kind: "issue", id: item.id })}
                    >
                      删除
                    </button>
                  </RowMenu>
                </div>
                {pendingItemDelete?.kind === "issue" && pendingItemDelete.id === item.id ? (
                  <ItemDeleteConfirm
                    label="确认删除问题"
                    copy={itemDeleteConfirmCopy("issue", item.text.trim())}
                    onCancel={() => setPendingItemDelete(null)}
                    onConfirm={commitItemDelete}
                  />
                ) : null}
                </div>
              </article>
              );
            })}
                </div>
                ) : null}
              </section>
              );
            })}
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
          <div className="zone-tag-groups">
            {groupByDisplayTag(value.nextWeek, nextWeekDisplayTag).map((group) => (
              <section key={group.tag} className="zone-tag-group" aria-label={`下周分组 ${group.tag}`}>
                <h4 className="zone-tag-heading">{group.tag}</h4>
                <div className="merge-list">
            {group.items.map((row) => {
              const index = value.nextWeek.findIndex((item) => item.id === row.id);
              const tag = nextWeekDisplayTag(row);
              return (
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
                    <span className="zone-item-tag">{tag}</span>
                    <input
                      className="text-input"
                      placeholder="项目"
                      aria-label={`下周项目 ${index + 1}`}
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
                    <NextWeekAiButton item={row} onApply={applyNextSummary} />
                    <RowMenu label={`更多 下周计划 ${row.projectName || index + 1}`}>
                      <button
                        type="button"
                        role="menuitem"
                        className="row-menu-item"
                        onClick={() => setPendingItemDelete({ kind: "nextWeek", id: row.id })}
                      >
                        删除
                      </button>
                    </RowMenu>
                  </div>
                  {pendingItemDelete?.kind === "nextWeek" && pendingItemDelete.id === row.id ? (
                    <ItemDeleteConfirm
                      label="确认删除下周计划"
                      copy={itemDeleteConfirmCopy("nextWeek", row.projectName)}
                      onCancel={() => setPendingItemDelete(null)}
                      onConfirm={commitItemDelete}
                    />
                  ) : null}
                  <textarea
                    className="text-input"
                    placeholder="工作内容（每行一条）"
                    value={row.items.join("\n")}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        nextWeek: value.nextWeek.map((item) => {
                          if (item.id !== row.id) return item;
                          const items = event.target.value.split("\n");
                          return clearLineMeta(applyNextWeekProjectName({ ...item, items }, "edit"));
                        }),
                      })
                    }
                  />
                </div>
              </article>
              );
            })}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ProjectBulletsEditor({
  label,
  bullets,
  onCommit,
}: {
  label: string;
  bullets: string[];
  onCommit: (next: string[]) => void;
}) {
  // Keeps a trailing newline while focused. The draft array drops blank lines.
  const [raw, setRaw] = useState<string | null>(null);
  const canonical = bullets.join("\n");
  const value = raw !== null && sameBullets(bulletsFromLines(raw), bullets) ? raw : canonical;

  return (
    <textarea
      className="text-input project-bullets-input"
      aria-label={label}
      placeholder="进展要点（每行一条）"
      value={value}
      onChange={(event) => {
        const nextRaw = event.target.value;
        const next = bulletsFromLines(nextRaw);
        setRaw(nextRaw);
        if (!sameBullets(next, bullets)) onCommit(next);
      }}
      onBlur={() => setRaw(null)}
    />
  );
}

function ItemDeleteConfirm({
  label,
  copy,
  onCancel,
  onConfirm,
}: {
  label: string;
  copy: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="project-delete-confirm" role="alertdialog" aria-label={label}>
      <p>{copy}</p>
      <div className="inline-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="btn btn-danger btn-sm" onClick={onConfirm}>
          确定删除
        </button>
      </div>
    </div>
  );
}

function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details className="row-menu" ref={ref}>
      <summary className="btn btn-ghost btn-sm" aria-label={label}>
        <span aria-hidden="true">⋯</span>
      </summary>
      <div
        className="row-menu-pop"
        role="menu"
        onClick={() => {
          ref.current?.removeAttribute("open");
        }}
      >
        {children}
      </div>
    </details>
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
