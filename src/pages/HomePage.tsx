import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { continueFrom } from "../lib/report";
import { STATUS_LABEL } from "../lib/report";
import { useReports } from "../store";

export function HomePage() {
  const { reports, create, remove, ready, error } = useReports();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const sorted = [...reports].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const startNew = async () => {
    setBusy(true);
    try {
      const report = await create();
      navigate(`/reports/${report.id}/meta`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "无法创建草稿，请确认本机服务已启动。");
    } finally {
      setBusy(false);
    }
  };

  const continueLast = async () => {
    const last = sorted[0];
    if (!last) {
      window.alert("暂无历史稿，请先新建一份汇报。");
      return;
    }
    setBusy(true);
    try {
      const next = await create(continueFrom(last));
      navigate(`/reports/${next.id}/meta`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "无法创建草稿，请确认本机服务已启动。");
    } finally {
      setBusy(false);
    }
  };

  const removeOne = async (id: string) => {
    try {
      await remove(id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "删除失败");
    }
  };

  return (
    <>
      <AppHeader />
      <div className="page">
        <section className="hero">
          <div>
            <h1>周 / 双周工作总结，10 分钟成稿</h1>
            <p>
              按项目录入进展、问题和下周计划，自动生成封面、目录、章节页、事项页与结束页，
              预览微调后导出标准 PPTX。甘特图时间轴等能力将在二期提供。
            </p>
          </div>
          <div className="hero-actions">
            <button className="btn btn-primary" disabled={busy || !ready} onClick={() => void startNew()}>
              新建周/双周总结
            </button>
            <button className="btn btn-secondary" disabled={busy || !ready} onClick={() => void continueLast()}>
              从上次续写
            </button>
          </div>
        </section>

        {error ? <div className="warn" style={{ marginBottom: 16 }}>{error}</div> : null}

        <h2 className="section-title">最近生成的汇报</h2>
        {!ready ? (
          <div className="panel empty">正在从本机服务读取草稿…</div>
        ) : sorted.length === 0 ? (
          <div className="panel empty">还没有草稿。点击上方按钮开始第一份周报。</div>
        ) : (
          <div className="card-list">
            {sorted.map((r) => (
              <div className="report-card" key={r.id}>
                <div>
                  <h3>
                    {r.title}
                    <span className="badge" style={{ marginLeft: 8 }}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </h3>
                  <p>
                    {r.department || "未填部门"} · {r.date} · {r.projects.filter((p) => p.name).length} 个项目
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      navigate(
                        r.slides.length
                          ? `/reports/${r.id}/preview`
                          : `/reports/${r.id}/materials`,
                      )
                    }
                  >
                    打开
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => void removeOne(r.id)}>
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
