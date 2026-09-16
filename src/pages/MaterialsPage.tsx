import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppHeader, Stepper } from "../components/AppHeader";
import { ReportGate } from "../components/ReportGate";
import { generateSlides, duplicateProjectNames } from "../lib/generateSlides";
import { canGenerate, emptyPlanRow, emptyProject } from "../lib/report";
import {
  SAMPLE_SPLIT_TEXT,
  cloneSampleNextWeek,
  cloneSampleProjects,
} from "../lib/sampleData";
import { splitProjectsFromText } from "../lib/splitText";
import { useReports } from "../store";
import type { Project, ProjectStatus, Report } from "../types";
import { PROJECT_STATUS_LABEL } from "../types";

type Tab = "projects" | "issues" | "plan";

export function MaterialsPage() {
  const { id } = useParams();
  return (
    <ReportGate id={id}>{(report) => <MaterialsForm report={report} />}</ReportGate>
  );
}

function MaterialsForm({ report }: { report: Report }) {
  const { patch, saveNow } = useReports();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("projects");
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitText, setSplitText] = useState(SAMPLE_SPLIT_TEXT);
  const [splitPreview, setSplitPreview] = useState<Project[] | null>(null);

  const dupes = useMemo(
    () => duplicateProjectNames(report.projects),
    [report],
  );

  const update = (updater: (r: Report) => Report) => patch(report.id, updater);

  const moveProject = (index: number, dir: -1 | 1) => {
    update((r) => {
      const next = [...r.projects];
      const j = index + dir;
      if (j < 0 || j >= next.length) return r;
      [next[index], next[j]] = [next[j], next[index]];
      return { ...r, projects: next };
    });
  };

  const generate = () => {
    const check = canGenerate(report);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setError("");
    setGenerating(true);
    window.setTimeout(() => {
      patch(report.id, (r) => ({
        ...r,
        slides: generateSlides(r),
        status: "generated",
      }));
      void saveNow(report.id).then(() => navigate(`/reports/${report.id}/preview`));
    }, 900);
  };

  return (
    <>
      <AppHeader />
      <div className="page">
        <Stepper current={2} />
        <div className="panel">
          <h2>录入素材</h2>
          <p className="hint">
            按项目填写进展要点。问题可留空（将生成 N/A 页）。下周计划可从项目名一键带入。
          </p>
          {error ? <div className="error">{error}</div> : null}
          {dupes.length ? (
            <div className="warn">存在同名项目：{dupes.join("、")}。建议改名，避免汇报时混淆。</div>
          ) : null}

          <div className="tabs">
            <button className={`tab${tab === "projects" ? " active" : ""}`} onClick={() => setTab("projects")}>
              重要事项
            </button>
            <button className={`tab${tab === "issues" ? " active" : ""}`} onClick={() => setTab("issues")}>
              存在问题与建议
            </button>
            <button className={`tab${tab === "plan" ? " active" : ""}`} onClick={() => setTab("plan")}>
              下周工作计划
            </button>
          </div>

          {tab === "projects" && (
            <>
              <div className="inline-actions" style={{ marginBottom: 12 }}>
                <button
                  className="btn btn-dark btn-sm"
                  onClick={() =>
                    update((r) => ({
                      ...r,
                      department: r.department || "软件研发",
                      date: r.date,
                      title: r.title || "周工作总结",
                      projects: cloneSampleProjects(),
                      issues: { empty: true, items: [] },
                      nextWeek: cloneSampleNextWeek(),
                    }))
                  }
                >
                  载入样例数据
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setSplitOpen(true)}>
                  从文本一键拆分
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => update((r) => ({ ...r, projects: [...r.projects, emptyProject()] }))}
                >
                  添加项目
                </button>
              </div>
              <div className="card-list">
                {report.projects.map((project, index) => (
                  <div className="project-card" key={project.id}>
                    <div className="project-head">
                      <span className="drag-handle">{index + 1}</span>
                      <input
                        className="text-input"
                        placeholder="项目名称 *"
                        value={project.name}
                        onChange={(e) =>
                          update((r) => ({
                            ...r,
                            projects: r.projects.map((p) =>
                              p.id === project.id ? { ...p, name: e.target.value } : p,
                            ),
                          }))
                        }
                      />
                      <select
                        value={project.status ?? ""}
                        onChange={(e) =>
                          update((r) => ({
                            ...r,
                            projects: r.projects.map((p) =>
                              p.id === project.id
                                ? { ...p, status: (e.target.value || undefined) as ProjectStatus | undefined }
                                : p,
                            ),
                          }))
                        }
                      >
                        <option value="">标签（可选）</option>
                        {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((k) => (
                          <option key={k} value={k}>{PROJECT_STATUS_LABEL[k]}</option>
                        ))}
                      </select>
                      <button className="btn btn-ghost btn-sm" onClick={() => moveProject(index, -1)}>上移</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => moveProject(index, 1)}>下移</button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() =>
                          update((r) => ({ ...r, projects: r.projects.filter((p) => p.id !== project.id) }))
                        }
                      >
                        删除
                      </button>
                    </div>
                    {project.bullets.map((bullet, bi) => (
                      <div className="bullet-row" key={`${project.id}-${bi}`}>
                        <textarea
                          className="text-input"
                          placeholder={`进展要点 ${bi + 1}`}
                          value={bullet}
                          onChange={(e) =>
                            update((r) => ({
                              ...r,
                              projects: r.projects.map((p) =>
                                p.id === project.id
                                  ? {
                                      ...p,
                                      bullets: p.bullets.map((b, i) => (i === bi ? e.target.value : b)),
                                    }
                                  : p,
                              ),
                            }))
                          }
                        />
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() =>
                            update((r) => ({
                              ...r,
                              projects: r.projects.map((p) =>
                                p.id === project.id
                                  ? { ...p, bullets: p.bullets.filter((_, i) => i !== bi) }
                                  : p,
                              ),
                            }))
                          }
                        >
                          删除
                        </button>
                      </div>
                    ))}
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        update((r) => ({
                          ...r,
                          projects: r.projects.map((p) =>
                            p.id === project.id ? { ...p, bullets: [...p.bullets, ""] } : p,
                          ),
                        }))
                      }
                    >
                      添加要点
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === "issues" && (
            <>
              <label className="field" style={{ marginBottom: 12 }}>
                <span>
                  <input
                    type="checkbox"
                    checked={report.issues.empty}
                    onChange={(e) =>
                      update((r) => ({
                        ...r,
                        issues: { ...r.issues, empty: e.target.checked },
                      }))
                    }
                  />{" "}
                  本期无（生成 N/A 页）
                </span>
              </label>
              {!report.issues.empty && (
                <>
                  {report.issues.items.map((item) => (
                    <div className="bullet-row" key={item.id}>
                      <textarea
                        className="text-input"
                        value={item.text}
                        placeholder="问题或建议"
                        onChange={(e) =>
                          update((r) => ({
                            ...r,
                            issues: {
                              ...r.issues,
                              items: r.issues.items.map((it) =>
                                it.id === item.id ? { ...it, text: e.target.value } : it,
                              ),
                            },
                          }))
                        }
                      />
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() =>
                          update((r) => ({
                            ...r,
                            issues: {
                              ...r.issues,
                              items: r.issues.items.filter((it) => it.id !== item.id),
                            },
                          }))
                        }
                      >
                        删除
                      </button>
                    </div>
                  ))}
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      update((r) => ({
                        ...r,
                        issues: {
                          empty: false,
                          items: [...r.issues.items, { id: crypto.randomUUID(), text: "" }],
                        },
                      }))
                    }
                  >
                    添加一条
                  </button>
                </>
              )}
            </>
          )}

          {tab === "plan" && (
            <>
              <div className="inline-actions" style={{ marginBottom: 12 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    update((r) => {
                      const existing = new Set(r.nextWeek.map((row) => row.projectName.trim()));
                      const added = r.projects
                        .filter((p) => p.name.trim() && !existing.has(p.name.trim()))
                        .map((p) => emptyPlanRow(p.name));
                      return { ...r, nextWeek: [...r.nextWeek, ...added] };
                    })
                  }
                >
                  从重要事项带入项目名
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => update((r) => ({ ...r, nextWeek: [...r.nextWeek, emptyPlanRow()] }))}
                >
                  添加一行
                </button>
              </div>
              <table className="plan-table">
                <thead>
                  <tr>
                    <th style={{ width: "28%" }}>项目</th>
                    <th>工作内容（每行一条）</th>
                    <th style={{ width: 72 }} />
                  </tr>
                </thead>
                <tbody>
                  {report.nextWeek.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <input
                          className="text-input"
                          value={row.projectName}
                          onChange={(e) =>
                            update((r) => ({
                              ...r,
                              nextWeek: r.nextWeek.map((n) =>
                                n.id === row.id ? { ...n, projectName: e.target.value } : n,
                              ),
                            }))
                          }
                        />
                      </td>
                      <td>
                        <textarea
                          className="text-input"
                          value={row.items.join("\n")}
                          onChange={(e) =>
                            update((r) => ({
                              ...r,
                              nextWeek: r.nextWeek.map((n) =>
                                n.id === row.id ? { ...n, items: e.target.value.split("\n") } : n,
                              ),
                            }))
                          }
                        />
                      </td>
                      <td>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() =>
                            update((r) => ({
                              ...r,
                              nextWeek: r.nextWeek.filter((n) => n.id !== row.id),
                            }))
                          }
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="footer-bar">
            <button className="btn btn-ghost" onClick={() => navigate(`/reports/${report.id}/meta`)}>
              上一步
            </button>
            <button className="btn btn-primary" onClick={generate}>
              生成预览
            </button>
          </div>
        </div>
      </div>

      {generating && (
        <div className="overlay">
          <div className="progress-card">
            <h3>正在生成初稿</h3>
            <p className="hint">解析素材 → 套模板 → 排版页序</p>
            <div className="progress-bar"><span /></div>
          </div>
        </div>
      )}

      {splitOpen && (
        <div className="overlay" onClick={() => setSplitOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>从文本拆分项目</h3>
            <p className="hint">识别「一、项目名 / 1. 项目名」标题和 ①②③ 要点。拆分结果需确认后才会写入。</p>
            <textarea
              className="text-input"
              style={{ minHeight: 180, width: "100%" }}
              value={splitText}
              onChange={(e) => setSplitText(e.target.value)}
            />
            {splitPreview && (
              <div className="hint" style={{ marginTop: 10 }}>
                将得到 {splitPreview.length} 个项目：
                {splitPreview.map((p) => p.name).join("、") || "（空）"}
              </div>
            )}
            <div className="footer-bar">
              <button className="btn btn-ghost" onClick={() => setSplitOpen(false)}>取消</button>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-ghost"
                  onClick={() => setSplitPreview(splitProjectsFromText(splitText))}
                >
                  预览拆分
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    const items = splitPreview ?? splitProjectsFromText(splitText);
                    if (!items.length) {
                      window.alert("没有识别到项目，请检查文本格式。");
                      return;
                    }
                    update((r) => ({ ...r, projects: items }));
                    setSplitOpen(false);
                    setSplitPreview(null);
                  }}
                >
                  确认替换
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
