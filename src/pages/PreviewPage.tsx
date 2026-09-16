import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { ReportGate } from "../components/ReportGate";
import { SlideFrame } from "../components/SlideFrame";
import { SlideView, slideTitle } from "../components/SlideView";
import { downloadPptx } from "../lib/exportPptx";
import { generateSlides } from "../lib/generateSlides";
import { emptyProject } from "../lib/report";
import { formatDateLabel } from "../lib/format";
import { useReports } from "../store";
import type {
  ClosingPayload,
  CoverPayload,
  IssuesPayload,
  PartPayload,
  PlanPayload,
  ProjectPayload,
  ProjectStatus,
  Report,
  Slide,
} from "../types";
import { PROJECT_STATUS_LABEL } from "../types";

function as<T>(payload: Slide["payload"]): T {
  return payload as T;
}

export function PreviewPage() {
  const { id } = useParams();
  return <ReportGate id={id}>{(report) => <PreviewWorkspace report={report} />}</ReportGate>;
}

function PreviewWorkspace({ report }: { report: Report }) {
  const { patch, saveNow } = useReports();
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const slides = report?.slides ?? [];
  const current = slides[Math.min(index, Math.max(slides.length - 1, 0))];

  const typeLabel = useMemo(() => (current ? slideTitle(current, index) : ""), [current, index]);

  if (!slides.length) {
    return (
      <>
        <AppHeader />
        <div className="page">
          <div className="panel">
            <p>尚未生成幻灯片。</p>
            <button className="btn btn-primary" onClick={() => navigate(`/reports/${report.id}/materials`)}>
              去录入素材
            </button>
          </div>
        </div>
      </>
    );
  }

  const updateSlides = (next: Slide[], extra?: Partial<typeof report>) => {
    patch(report.id, (r) => ({ ...r, ...extra, slides: next }));
  };

  const regenerate = () => {
    const next = generateSlides(report);
    patch(report.id, (r) => ({ ...r, slides: next, status: "generated" }));
    setIndex(0);
    setMessage("已按当前素材重新排版");
  };

  const exportFile = async () => {
    setBusy(true);
    setMessage("");
    try {
      const name = await downloadPptx(report);
      patch(report.id, (r) => ({ ...r, status: "exported" }));
      setMessage(`已开始下载 ${name}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "导出失败");
    } finally {
      setBusy(false);
    }
  };

  const deleteCurrent = () => {
    if (!current || current.type !== "project") {
      window.alert("当前版本仅支持删除项目进展页。");
      return;
    }
    const payload = as<ProjectPayload>(current.payload);
    if (!window.confirm(`删除项目「${payload.name}」的全部进展页？`)) return;
    patch(report.id, (r) => {
      const projects = r.projects.filter((p) => p.id !== payload.projectId);
      const nextReport = { ...r, projects };
      return { ...nextReport, slides: generateSlides(nextReport) };
    });
    setIndex(0);
  };

  const insertProject = () => {
    patch(report.id, (r) => {
      const project = emptyProject();
      project.name = "新项目";
      project.bullets = ["请填写进展要点"];
      const nextReport = { ...r, projects: [...r.projects, project] };
      return { ...nextReport, slides: generateSlides(nextReport) };
    });
  };

  const moveProject = (dir: -1 | 1) => {
    if (!current || current.type !== "project") return;
    const payload = as<ProjectPayload>(current.payload);
    patch(report.id, (r) => {
      const ids = r.projects.map((p) => p.id);
      const i = ids.indexOf(payload.projectId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return r;
      const projects = [...r.projects];
      [projects[i], projects[j]] = [projects[j], projects[i]];
      const nextReport = { ...r, projects };
      return { ...nextReport, slides: generateSlides(nextReport) };
    });
  };

  return (
    <div className="preview-shell">
      <div className="preview-top">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/reports/${report.id}/materials`)}>
            返回素材
          </button>
          <h1>{report.title} · {report.department}</h1>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              void saveNow(report.id).then(() => setMessage("草稿已保存到本机服务"));
            }}
          >
            保存草稿
          </button>
          <button className="btn btn-ghost btn-sm" onClick={regenerate}>再生成</button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={exportFile}>
            {busy ? "导出中…" : "导出 PPTX"}
          </button>
        </div>
      </div>
      <div className="preview-body">
        <aside className="thumbs">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              className={`thumb${i === index ? " active" : ""}`}
              onClick={() => setIndex(i)}
            >
              <SlideFrame mini>
                <SlideView slide={slide} page={i + 1} total={slides.length} />
              </SlideFrame>
              <div className="thumb-label">{i + 1}. {slideTitle(slide, i)}</div>
            </button>
          ))}
        </aside>
        <main className="stage-col">
          {message ? <div className="warn" style={{ width: "min(100%, 960px)" }}>{message}</div> : null}
          <SlideFrame>
            <SlideView slide={current} page={index + 1} total={slides.length} />
          </SlideFrame>
          <div className="inline-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => moveProject(-1)}>项目上移</button>
            <button className="btn btn-ghost btn-sm" onClick={() => moveProject(1)}>项目下移</button>
            <button className="btn btn-ghost btn-sm" onClick={insertProject}>插入项目页</button>
            <button className="btn btn-danger btn-sm" onClick={deleteCurrent}>删除当前项目</button>
          </div>
        </main>
        <aside className="props">
          <h3>{typeLabel}</h3>
          {current.type === "cover" && (
            <CoverEditor
              payload={as<CoverPayload>(current.payload)}
              onChange={(payload) => {
                const next = slides.map((s) => (s.id === current.id ? { ...s, payload } : s));
                updateSlides(next, {
                  title: payload.title,
                  department: payload.department,
                  author: payload.author,
                });
              }}
            />
          )}
          {current.type === "project" && (
            <ProjectEditor
              payload={as<ProjectPayload>(current.payload)}
              onChange={(payload) => {
                patch(report.id, (r) => {
                  const projects = r.projects.map((p) => {
                    if (p.id !== payload.projectId) return p;
                    const before = p.bullets.slice(0, payload.bulletOffset);
                    const oldLen = as<ProjectPayload>(current.payload).bullets.length;
                    const after = p.bullets.slice(payload.bulletOffset + oldLen);
                    return {
                      ...p,
                      name: payload.name,
                      status: payload.status,
                      bullets: [...before, ...payload.bullets, ...after],
                    };
                  });
                  const slidesNext = r.slides.map((s) =>
                    s.id === current.id ? { ...s, payload } : s.type === "project" && as<ProjectPayload>(s.payload).projectId === payload.projectId
                      ? { ...s, payload: { ...as<ProjectPayload>(s.payload), name: payload.name, status: payload.status } }
                      : s,
                  );
                  return { ...r, projects, slides: slidesNext };
                });
              }}
            />
          )}
          {current.type === "issues" && (
            <IssuesEditor
              payload={as<IssuesPayload>(current.payload)}
              onChange={(payload) => {
                const next = slides.map((s) => (s.id === current.id ? { ...s, payload } : s));
                updateSlides(next, {
                  issues: {
                    empty: payload.empty,
                    items: payload.empty
                      ? report.issues.items
                      : payload.items.map((text, i) => ({
                          id: report.issues.items[i]?.id ?? crypto.randomUUID(),
                          text,
                        })),
                  },
                });
              }}
            />
          )}
          {current.type === "plan" && (
            <PlanEditor
              payload={as<PlanPayload>(current.payload)}
              onChange={(payload) => {
                const next = slides.map((s) => (s.id === current.id ? { ...s, payload } : s));
                updateSlides(next, {
                  nextWeek: payload.rows.map((row, i) => ({
                    id: report.nextWeek[i]?.id ?? crypto.randomUUID(),
                    projectName: row.projectName,
                    items: row.items,
                  })),
                });
              }}
            />
          )}
          {current.type === "part" && (
            <div className="field">
              <label>章节标题</label>
              <input
                value={as<PartPayload>(current.payload).title}
                onChange={(e) => {
                  const payload = { ...as<PartPayload>(current.payload), title: e.target.value };
                  updateSlides(slides.map((s) => (s.id === current.id ? { ...s, payload } : s)));
                }}
              />
            </div>
          )}
          {current.type === "closing" && (
            <div className="field">
              <label>结束语</label>
              <input
                value={as<ClosingPayload>(current.payload).message}
                onChange={(e) => {
                  const payload = { ...as<ClosingPayload>(current.payload), message: e.target.value };
                  updateSlides(slides.map((s) => (s.id === current.id ? { ...s, payload } : s)));
                }}
              />
              <p className="hint">结束页不含任何模板广告或水印。</p>
            </div>
          )}
          {current.type === "toc" && <p className="hint">目录为固定结构：重要事项 / 问题建议 / 下周计划。</p>}
        </aside>
      </div>
    </div>
  );
}

function CoverEditor({
  payload,
  onChange,
}: {
  payload: CoverPayload;
  onChange: (p: CoverPayload) => void;
}) {
  return (
    <>
      <div className="field">
        <label>标题</label>
        <input value={payload.title} onChange={(e) => onChange({ ...payload, title: e.target.value })} />
      </div>
      <div className="field">
        <label>部门</label>
        <input value={payload.department} onChange={(e) => onChange({ ...payload, department: e.target.value })} />
      </div>
      <div className="field">
        <label>日期展示</label>
        <input value={payload.dateLabel} onChange={(e) => onChange({ ...payload, dateLabel: e.target.value })} />
      </div>
      <div className="field">
        <label>汇报人</label>
        <input value={payload.author} onChange={(e) => onChange({ ...payload, author: e.target.value })} />
      </div>
      <p className="hint">当前日期格式示例：{formatDateLabel("2026-09-16")}</p>
    </>
  );
}

function ProjectEditor({
  payload,
  onChange,
}: {
  payload: ProjectPayload;
  onChange: (p: ProjectPayload) => void;
}) {
  return (
    <>
      <div className="field">
        <label>项目名称</label>
        <input value={payload.name} onChange={(e) => onChange({ ...payload, name: e.target.value })} />
      </div>
      <div className="field">
        <label>标签</label>
        <select
          value={payload.status ?? ""}
          onChange={(e) =>
            onChange({ ...payload, status: (e.target.value || undefined) as ProjectStatus | undefined })
          }
        >
          <option value="">无</option>
          {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((k) => (
            <option key={k} value={k}>{PROJECT_STATUS_LABEL[k]}</option>
          ))}
        </select>
      </div>
      {payload.bullets.map((b, i) => (
        <div className="field" key={i}>
          <label>要点 {i + 1}</label>
          <textarea
            value={b}
            onChange={(e) =>
              onChange({
                ...payload,
                bullets: payload.bullets.map((x, idx) => (idx === i ? e.target.value : x)),
              })
            }
          />
        </div>
      ))}
      <div className="inline-actions">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onChange({ ...payload, bullets: [...payload.bullets, ""] })}
        >
          添加要点
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onChange({ ...payload, bullets: payload.bullets.slice(0, -1) })}
        >
          删末条
        </button>
      </div>
      <p className="hint">单页建议不超过 6 条要点；超出可点「再生成」自动拆成续页。</p>
    </>
  );
}

function IssuesEditor({
  payload,
  onChange,
}: {
  payload: IssuesPayload;
  onChange: (p: IssuesPayload) => void;
}) {
  return (
    <>
      <label className="field">
        <span>
          <input
            type="checkbox"
            checked={payload.empty}
            onChange={(e) => onChange({ ...payload, empty: e.target.checked, items: e.target.checked ? [] : payload.items })}
          />{" "}
          本期无（N/A）
        </span>
      </label>
      {!payload.empty &&
        payload.items.map((item, i) => (
          <div className="field" key={i}>
            <label>条目 {i + 1}</label>
            <textarea
              value={item}
              onChange={(e) =>
                onChange({
                  ...payload,
                  items: payload.items.map((x, idx) => (idx === i ? e.target.value : x)),
                })
              }
            />
          </div>
        ))}
      {!payload.empty && (
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onChange({ ...payload, items: [...payload.items, ""] })}
        >
          添加条目
        </button>
      )}
    </>
  );
}

function PlanEditor({
  payload,
  onChange,
}: {
  payload: PlanPayload;
  onChange: (p: PlanPayload) => void;
}) {
  return (
    <>
      {payload.rows.map((row, i) => (
        <div key={i} className="field">
          <label>项目 {i + 1}</label>
          <input
            value={row.projectName}
            onChange={(e) =>
              onChange({
                ...payload,
                rows: payload.rows.map((r, idx) =>
                  idx === i ? { ...r, projectName: e.target.value } : r,
                ),
              })
            }
          />
          <textarea
            value={row.items.join("\n")}
            onChange={(e) =>
              onChange({
                ...payload,
                rows: payload.rows.map((r, idx) =>
                  idx === i ? { ...r, items: e.target.value.split("\n") } : r,
                ),
              })
            }
          />
        </div>
      ))}
    </>
  );
}
