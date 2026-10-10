import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  IssuePartitionAiButton,
  NextWeekPartitionAiButton,
  ProjectAiButton,
} from "./AiSummarizeControl";
import {
  EMPTY_PARTITION_SELECTION,
  applyNextWeekProjectName,
  canMergePartitions,
  collapseIssuePartitions,
  collapseNextWeekPartitions,
  groupByDisplayTag,
  issueDisplayTag,
  issueGroupBody,
  mergeIssuePartitions,
  mergeNextWeekPartitions,
  movePartitionItems,
  nextWeekDisplayTag,
  nextWeekGroupBody,
  normalizePartitionName,
  renameIssuePartition,
  renameNextWeekPartition,
  setPartitionPrimary,
  togglePartitionSelection,
  writeIssuePartitionBody,
  writeNextWeekPartitionBody,
  type PartitionSelection,
  type PartitionZone,
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
  // Session-only open sets. Empty means collapsed, including rows added later in the session.
  // Not written to the draft, localStorage, or the URL. resetKey clears them.
  const [openProjectIds, setOpenProjectIds] = useState<ReadonlySet<string>>(() => new Set());
  const [openIssueTags, setOpenIssueTags] = useState<ReadonlySet<string>>(() => new Set());
  const [openPlanTags, setOpenPlanTags] = useState<ReadonlySet<string>>(() => new Set());
  const [partitionSel, setPartitionSel] = useState<PartitionSelection>(EMPTY_PARTITION_SELECTION);
  const seededNextWeekIds = useRef(new Set<string>());

  useEffect(() => {
    setSelection(EMPTY_SELECTION);
    setUndo([]);
    setError("");
    setPendingDeleteId(null);
    setOpenProjectIds(new Set());
    setOpenIssueTags(new Set());
    setOpenPlanTags(new Set());
    setPartitionSel(EMPTY_PARTITION_SELECTION);
    seededNextWeekIds.current.clear();
  }, [resetKey]);

  useEffect(() => {
    let nameChanged = false;
    const namedNextWeek = value.nextWeek.map((row) => {
      if (seededNextWeekIds.current.has(row.id)) return row;
      seededNextWeekIds.current.add(row.id);
      const filled = applyNextWeekProjectName(row, "load");
      if (filled !== row) nameChanged = true;
      return filled;
    });
    const seeded = nameChanged ? namedNextWeek : value.nextWeek;
    const nextWeek = collapseNextWeekPartitions(seeded);
    const issues = collapseIssuePartitions(value.issues.items);
    if (nextWeek === value.nextWeek && issues === value.issues.items) return;
    onChange({
      ...value,
      projects: value.projects,
      issues: issues === value.issues.items ? value.issues : { ...value.issues, items: issues },
      nextWeek,
    });
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

  const toggleOpenTag = (
    setOpenTags: (update: (current: ReadonlySet<string>) => ReadonlySet<string>) => void,
    tag: string,
  ) => {
    setOpenTags((current) => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const toggle = (zone: MergeZone, id: string) => {
    setPartitionSel(EMPTY_PARTITION_SELECTION);
    const result = toggleSelection(selection, zone, id);
    setError(result.error ?? "");
    setSelection(result.selection);
  };

  const togglePartition = (zone: PartitionZone, tag: string) => {
    setSelection(EMPTY_SELECTION);
    const result = togglePartitionSelection(partitionSel, zone, tag);
    setError(result.error ?? "");
    setPartitionSel(result.selection);
  };

  const mergeSelectedPartitions = () => {
    if (!partitionSel.zone || !canMergePartitions(partitionSel)) {
      setError("请在同一分区至少选择 2 条");
      return;
    }
    const projects = value.projects;
    if (partitionSel.zone === "issues") {
      const items = mergeIssuePartitions(value.issues.items, partitionSel.tags, partitionSel.primaryTag);
      if (items === value.issues.items) return;
      setUndo((stack) => [...stack, value]);
      setPartitionSel(EMPTY_PARTITION_SELECTION);
      setSelection(EMPTY_SELECTION);
      setError("");
      onChange({ ...value, projects, issues: { ...value.issues, items } });
      return;
    }
    const nextWeek = mergeNextWeekPartitions(value.nextWeek, partitionSel.tags, partitionSel.primaryTag);
    if (nextWeek === value.nextWeek) return;
    setUndo((stack) => [...stack, value]);
    setPartitionSel(EMPTY_PARTITION_SELECTION);
    setSelection(EMPTY_SELECTION);
    setError("");
    onChange({ ...value, projects, nextWeek });
  };

  const mergeSelected = () => {
    if (canMergePartitions(partitionSel)) {
      mergeSelectedPartitions();
      return;
    }
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
    setPartitionSel(EMPTY_PARTITION_SELECTION);
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

  const applyIssuePartitionSummary = (updates: { id: string; text: string }[]) => {
    const base = collapseIssuePartitions(value.issues.items);
    const byId = new Map(updates.map((row) => [row.id, row.text]));
    let changed = base !== value.issues.items;
    const items = base.map((item) => {
      const text = byId.get(item.id);
      if (text == null || text === item.text) return item;
      changed = true;
      return clearLineMeta({ ...item, text });
    });
    if (!changed) return;
    onChange({
      ...value,
      projects: value.projects,
      issues: { ...value.issues, items: collapseIssuePartitions(items) },
    });
  };

  const applyNextPartitionSummary = (updates: { id: string; items: string[] }[]) => {
    const base = collapseNextWeekPartitions(value.nextWeek);
    const byId = new Map(updates.map((row) => [row.id, row.items]));
    let changed = base !== value.nextWeek;
    const nextWeek = base.map((item) => {
      const items = byId.get(item.id);
      if (!items || sameBullets(item.items, items)) return item;
      changed = true;
      return clearLineMeta({ ...item, items });
    });
    if (!changed) return;
    onChange({ ...value, projects: value.projects, nextWeek: collapseNextWeekPartitions(nextWeek) });
  };

  const rememberPartitionTag = (
    openTags: ReadonlySet<string>,
    selection: PartitionSelection,
    zone: PartitionZone,
    from: string,
    to: string,
  ) => {
    if (openTags.has(from)) {
      const next = new Set(openTags);
      next.delete(from);
      next.add(to);
      if (zone === "issues") setOpenIssueTags(next);
      else setOpenPlanTags(next);
    }
    if (selection.zone === zone && selection.tags.includes(from)) {
      const tags = [...new Set(selection.tags.map((tag) => (tag === from ? to : tag)))];
      setPartitionSel({
        zone,
        tags,
        primaryTag: selection.primaryTag === from ? to : selection.primaryTag,
      });
    }
  };

  const renameIssueGroup = (from: string, raw: string) => {
    const to = normalizePartitionName(raw);
    const items = renameIssuePartition(value.issues.items, from, to);
    if (items === value.issues.items) return;
    rememberPartitionTag(openIssueTags, partitionSel, "issues", from, to);
    onChange({ ...value, projects: value.projects, issues: { ...value.issues, items } });
  };

  const renamePlanGroup = (from: string, raw: string) => {
    const to = normalizePartitionName(raw);
    const nextWeek = renameNextWeekPartition(value.nextWeek, from, to);
    if (nextWeek === value.nextWeek) return;
    rememberPartitionTag(openPlanTags, partitionSel, "nextWeek", from, to);
    onChange({ ...value, projects: value.projects, nextWeek });
  };

  const moveIssueGroup = (tag: string, dir: -1 | 1) => {
    const items = movePartitionItems(value.issues.items, tag, dir, issueDisplayTag);
    if (items === value.issues.items) return;
    onChange({ ...value, projects: value.projects, issues: { ...value.issues, items } });
  };

  const movePlanGroup = (tag: string, dir: -1 | 1) => {
    const nextWeek = movePartitionItems(value.nextWeek, tag, dir, nextWeekDisplayTag);
    if (nextWeek === value.nextWeek) return;
    onChange({ ...value, projects: value.projects, nextWeek });
  };

  const zoneName = selection.zone ? ZONE_LABEL[selection.zone] : "";
  const partitionZoneName = partitionSel.zone ? ZONE_LABEL[partitionSel.zone] : "";
  const statusText = error
    ? error
    : partitionSel.tags.length >= 2
      ? `已选 ${partitionSel.tags.length} 个分区（${partitionZoneName}）。标题取较长名称，等长取主项。正文按顺序拼进同一条。`
      : selection.ids.length >= 2
        ? `已选 ${selection.ids.length} 条（${zoneName}）。标题取较长名称，等长取主项。`
        : "";

  const selected = new Set(selection.ids);
  const activeZone = selection.zone;
  const issueItems = collapseIssuePartitions(value.issues.items);
  const planRows = collapseNextWeekPartitions(value.nextWeek);

  return (
    <div className={`merge-panel${scrollable ? " merge-panel-scroll" : ""}`}>
      <div className="merge-toolbar">
        {statusText ? (
          <p className={error ? "error merge-status" : "hint merge-status"}>{statusText}</p>
        ) : (
          <span className="merge-status" />
        )}
        <div className="inline-actions">
          <button
            className="btn btn-primary btn-sm"
            disabled={!canMergeSelection(selection) && !canMergePartitions(partitionSel)}
            onClick={mergeSelected}
          >
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
        {value.issues.empty ? null : issueItems.length === 0 ? (
          <div className="panel empty" style={{ boxShadow: "none" }}>暂无问题或建议。</div>
        ) : (
          <div className="zone-tag-groups">
            {groupByDisplayTag(issueItems, issueDisplayTag).map((group, groupIndex) => {
              const open = openIssueTags.has(group.tag);
              const partitionChecked = partitionSel.zone === "issues" && partitionSel.tags.includes(group.tag);
              return (
              <section
                key={group.items[0]?.id ?? group.tag}
                className={`issue-partition${open ? "" : " is-collapsed"}`}
                aria-label={`问题分组 ${group.tag}`}
              >
                <div className="project-head issue-partition-head">
                  <label className="merge-check">
                    <input
                      type="checkbox"
                      checked={partitionChecked}
                      aria-label={`选择问题分区 ${group.tag}`}
                      onChange={() => togglePartition("issues", group.tag)}
                    />
                  </label>
                  <PrimaryMark
                    selected={partitionChecked}
                    primary={partitionSel.zone === "issues" && partitionSel.primaryTag === group.tag}
                    onSetPrimary={() => setPartitionSel(setPartitionPrimary(partitionSel, group.tag))}
                  />
                  <span className="drag-handle">{groupIndex + 1}</span>
                  <PartitionNameInput name={group.tag} onRename={(next) => renameIssueGroup(group.tag, next)} />
                  <span className="issue-partition-count">{bulletsFromLines(issueGroupBody(group.items)).length} 条</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveIssueGroup(group.tag, -1)}>上移</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveIssueGroup(group.tag, 1)}>下移</button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-expanded={open}
                    aria-label={`${open ? "收起" : "展开"}问题分组 ${group.tag}`}
                    onClick={() => toggleOpenTag(setOpenIssueTags, group.tag)}
                  >
                    {open ? "收起" : "展开"}
                  </button>
                  <IssuePartitionAiButton tag={group.tag} items={group.items} onApply={applyIssuePartitionSummary} />
                </div>
                {open ? (
                <div className="issue-partition-body">
                  {group.items.some((item) => item.text.trim() !== "") ? (
                    <textarea
                      className="text-input"
                      placeholder="问题或建议"
                      aria-label={`问题内容 ${partitionAnchorIndex(issueItems, group.items, (item) => item.text.trim() !== "") + 1}`}
                      value={issueGroupBody(group.items)}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          projects: value.projects,
                          issues: {
                            ...value.issues,
                            items: writeIssuePartitionBody(value.issues.items, group.tag, event.target.value),
                          },
                        })
                      }
                    />
                  ) : null}
                  {group.items.filter((item) => item.text.trim() === "").map((item) => (
                    <textarea
                      key={item.id}
                      className="text-input"
                      placeholder="问题或建议"
                      aria-label={`问题内容 ${Math.max(issueItems.findIndex((row) => row.id === item.id), 0) + 1}`}
                      value={item.text}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          projects: value.projects,
                          issues: {
                            ...value.issues,
                            items: value.issues.items.map((row) =>
                              row.id === item.id ? clearLineMeta({ ...row, text: event.target.value }) : row,
                            ),
                          },
                        })
                      }
                    />
                  ))}
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
        {planRows.length === 0 ? (
          <div className="panel empty" style={{ boxShadow: "none" }}>暂无下周计划。</div>
        ) : (
          <div className="zone-tag-groups">
            {groupByDisplayTag(planRows, nextWeekDisplayTag).map((group, groupIndex) => {
              const open = openPlanTags.has(group.tag);
              const partitionChecked = partitionSel.zone === "nextWeek" && partitionSel.tags.includes(group.tag);
              return (
              <section
                key={group.items[0]?.id ?? group.tag}
                className={`issue-partition${open ? "" : " is-collapsed"}`}
                aria-label={`下周分组 ${group.tag}`}
              >
                <div className="project-head issue-partition-head">
                  <label className="merge-check">
                    <input
                      type="checkbox"
                      checked={partitionChecked}
                      aria-label={`选择下周分区 ${group.tag}`}
                      onChange={() => togglePartition("nextWeek", group.tag)}
                    />
                  </label>
                  <PrimaryMark
                    selected={partitionChecked}
                    primary={partitionSel.zone === "nextWeek" && partitionSel.primaryTag === group.tag}
                    onSetPrimary={() => setPartitionSel(setPartitionPrimary(partitionSel, group.tag))}
                  />
                  <span className="drag-handle">{groupIndex + 1}</span>
                  <PartitionNameInput name={group.tag} onRename={(next) => renamePlanGroup(group.tag, next)} />
                  <span className="issue-partition-count">{bulletsFromLines(nextWeekGroupBody(group.items)).length} 条</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => movePlanGroup(group.tag, -1)}>上移</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => movePlanGroup(group.tag, 1)}>下移</button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-expanded={open}
                    aria-label={`${open ? "收起" : "展开"}下周分组 ${group.tag}`}
                    onClick={() => toggleOpenTag(setOpenPlanTags, group.tag)}
                  >
                    {open ? "收起" : "展开"}
                  </button>
                  <NextWeekPartitionAiButton tag={group.tag} items={group.items} onApply={applyNextPartitionSummary} />
                </div>
                {open ? (
                <div className="issue-partition-body">
                  {group.items.some((row) => row.items.some((line) => line.trim() !== "")) ? (
                    <textarea
                      className="text-input next-week-body"
                      placeholder="工作内容（每行一条）"
                      aria-label={`下周内容 ${partitionAnchorIndex(planRows, group.items, (row) => row.items.some((line) => line.trim() !== "")) + 1}`}
                      value={nextWeekGroupBody(group.items)}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          projects: value.projects,
                          nextWeek: writeNextWeekPartitionBody(value.nextWeek, group.tag, event.target.value),
                        })
                      }
                    />
                  ) : null}
                  {group.items.filter((row) => !row.items.some((line) => line.trim() !== "")).map((row) => (
                    <textarea
                      key={row.id}
                      className="text-input next-week-body"
                      placeholder="工作内容（每行一条）"
                      aria-label={`下周内容 ${Math.max(planRows.findIndex((item) => item.id === row.id), 0) + 1}`}
                      value={row.items.join("\n")}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          projects: value.projects,
                          nextWeek: value.nextWeek.map((item) => {
                            if (item.id !== row.id) return item;
                            return clearLineMeta(applyNextWeekProjectName({ ...item, items: event.target.value.split("\n") }, "edit"));
                          }),
                        })
                      }
                    />
                  ))}
                </div>
                ) : null}
              </section>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function PartitionNameInput({ name, onRename }: { name: string; onRename: (next: string) => void }) {
  // Draft only while the field is empty or not yet normalized. A cleared name
  // commits to 未分类 on blur, same as a missing 【】 pair.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? name;
  return (
    <input
      className="text-input issue-partition-name"
      placeholder="项目名称 *"
      aria-label={`分区名称 ${name}`}
      value={shown}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        const trimmed = raw.replace(/[【】]/g, "").trim();
        if (trimmed && trimmed !== name) onRename(trimmed);
      }}
      onBlur={() => {
        const next = normalizePartitionName(draft ?? name);
        setDraft(null);
        if (next !== name) onRename(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setDraft(null);
        }
      }}
    />
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

function partitionAnchorIndex<T extends { id: string }>(
  all: readonly T[],
  group: readonly T[],
  filled: (item: T) => boolean,
): number {
  const anchor = group.find(filled) ?? group[0];
  const index = all.findIndex((row) => row.id === anchor?.id);
  return index < 0 ? 0 : index;
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
