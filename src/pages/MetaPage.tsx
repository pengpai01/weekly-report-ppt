import { useNavigate, useParams } from "react-router-dom";
import { AppHeader, Stepper } from "../components/AppHeader";
import { defaultTitle } from "../lib/format";
import { useReports } from "../store";
import type { TemplateType } from "../types";
import { TEMPLATE_LABEL } from "../types";

export function MetaPage() {
  const { id } = useParams();
  const { getReport, patch } = useReports();
  const navigate = useNavigate();
  const report = id ? getReport(id) : undefined;

  if (!report) {
    return (
      <>
        <AppHeader />
        <div className="page"><div className="panel">找不到这份草稿。</div></div>
      </>
    );
  }

  const setTemplate = (templateType: TemplateType) => {
    patch(report.id, (r) => {
      const titleStillDefault =
        r.title === defaultTitle(r.templateType) || !r.title.trim();
      return {
        ...r,
        templateType,
        title: titleStillDefault ? defaultTitle(templateType) : r.title,
      };
    });
  };

  return (
    <>
      <AppHeader />
      <div className="page">
        <Stepper current={1} />
        <div className="panel">
          <h2>填写汇报元信息</h2>
          <p className="hint">先选定周报或双周报模板，再确认部门与日期。标题可改，默认随模板变化。</p>

          <div className="choice-row" style={{ marginBottom: 18 }}>
            {(["weekly", "biweekly"] as TemplateType[]).map((t) => (
              <button
                key={t}
                type="button"
                className={`choice${report.templateType === t ? " active" : ""}`}
                onClick={() => setTemplate(t)}
              >
                <strong>{TEMPLATE_LABEL[t]}</strong>
                <span>{t === "weekly" ? "覆盖一周工作" : "覆盖两周工作，页结构相同"}</span>
              </button>
            ))}
          </div>

          <div className="form-grid">
            <div className="field">
              <label>部门 *</label>
              <input
                value={report.department}
                placeholder="例如：软件研发"
                onChange={(e) => patch(report.id, (r) => ({ ...r, department: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>日期 *</label>
              <input
                type="date"
                value={report.date}
                onChange={(e) => patch(report.id, (r) => ({ ...r, date: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>汇报人（可选）</label>
              <input
                value={report.author}
                placeholder="可不填"
                onChange={(e) => patch(report.id, (r) => ({ ...r, author: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>标题</label>
              <input
                value={report.title}
                onChange={(e) => patch(report.id, (r) => ({ ...r, title: e.target.value }))}
              />
            </div>
          </div>

          <div className="footer-bar">
            <button className="btn btn-ghost" onClick={() => navigate("/")}>返回首页</button>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (!report.department.trim() || !report.date) {
                  window.alert("请填写部门和日期");
                  return;
                }
                navigate(`/reports/${report.id}/materials`);
              }}
            >
              下一步：录入素材
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
