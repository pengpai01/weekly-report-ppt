import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppHeader, Stepper } from "../components/AppHeader";
import { ReportGate } from "../components/ReportGate";
import { ZoneMergePanel } from "../components/ZoneMergePanel";
import { generateSlides, duplicateProjectNames } from "../lib/generateSlides";
import { canGenerate } from "../lib/report";
import {
  SAMPLE_SPLIT_TEXT,
  cloneSampleNextWeek,
  cloneSampleProjects,
} from "../lib/sampleData";
import { splitProjectsFromText } from "../lib/splitText";
import { useReports } from "../store";
import type { Project, Report } from "../types";

export function MaterialsPage() {
  const { id } = useParams();
  return (
    <ReportGate id={id}>{(report) => <MaterialsForm report={report} />}</ReportGate>
  );
}

function MaterialsForm({ report }: { report: Report }) {
  const { patch, saveNow } = useReports();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitText, setSplitText] = useState(SAMPLE_SPLIT_TEXT);
  const [splitPreview, setSplitPreview] = useState<Project[] | null>(null);
  const [zoneEpoch, setZoneEpoch] = useState(0);

  const dupes = useMemo(
    () => duplicateProjectNames(report.projects),
    [report],
  );

  const update = (updater: (r: Report) => Report) => patch(report.id, updater);

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
            按项目填写进展要点。勾选同一分区内至少 2 条可合并，合并后仍可编辑。撤销本次合并只在本页，不另请求接口；当前内容随草稿保存。问题可留空（将生成 N/A 页）。
          </p>
          {error ? <div className="error">{error}</div> : null}
          {dupes.length ? (
            <div className="warn">存在同名项目：{dupes.join("、")}。建议改名，避免汇报时混淆。</div>
          ) : null}

          <div className="inline-actions" style={{ marginBottom: 12 }}>
            <button
              className="btn btn-dark btn-sm"
              onClick={() => {
                update((r) => ({
                  ...r,
                  department: r.department || "软件研发",
                  date: r.date,
                  title: r.title || "周工作总结",
                  projects: cloneSampleProjects(),
                  issues: { empty: true, items: [] },
                  nextWeek: cloneSampleNextWeek(),
                }));
                setZoneEpoch((n) => n + 1);
              }}
            >
              载入样例数据
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setSplitOpen(true)}>
              从文本一键拆分
            </button>
          </div>

          <ZoneMergePanel
            resetKey={`${report.id}:${zoneEpoch}`}
            value={{
              projects: report.projects,
              issues: report.issues,
              nextWeek: report.nextWeek,
            }}
            onChange={(next) =>
              update((r) => ({
                ...r,
                projects: next.projects,
                issues: next.issues,
                nextWeek: next.nextWeek,
              }))
            }
          />

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
                    setZoneEpoch((n) => n + 1);
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
