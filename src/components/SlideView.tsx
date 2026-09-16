import type {
  ClosingPayload,
  CoverPayload,
  IssuesPayload,
  PartPayload,
  PlanPayload,
  ProjectPayload,
  Slide,
  TocPayload,
} from "../types";
import { PROJECT_STATUS_LABEL } from "../types";

function as<T>(payload: Slide["payload"]): T {
  return payload as T;
}

export function slideTitle(slide: Slide, index: number): string {
  switch (slide.type) {
    case "cover":
      return "封面";
    case "toc":
      return "目录";
    case "part":
      return `章节 ${as<PartPayload>(slide.payload).partNo}`;
    case "project": {
      const p = as<ProjectPayload>(slide.payload);
      return `${p.ordinal}、${p.name}${p.continued ? "（续）" : ""}`;
    }
    case "issues":
      return "问题与建议";
    case "plan":
      return "下周计划";
    case "closing":
      return "结束页";
    default:
      return `第 ${index + 1} 页`;
  }
}

export function SlideView({ slide, page, total }: { slide: Slide; page: number; total: number }) {
  switch (slide.type) {
    case "cover":
      return <Cover payload={as<CoverPayload>(slide.payload)} />;
    case "toc":
      return <Toc payload={as<TocPayload>(slide.payload)} page={page} total={total} />;
    case "part":
      return <Part payload={as<PartPayload>(slide.payload)} />;
    case "project":
      return <ProjectSlide payload={as<ProjectPayload>(slide.payload)} page={page} total={total} />;
    case "issues":
      return <Issues payload={as<IssuesPayload>(slide.payload)} page={page} total={total} />;
    case "plan":
      return <Plan payload={as<PlanPayload>(slide.payload)} page={page} total={total} />;
    case "closing":
      return <Closing payload={as<ClosingPayload>(slide.payload)} />;
  }
}

function Cover({ payload }: { payload: CoverPayload }) {
  return (
    <div className="ppt-cover" data-slide-type="cover">
      <div className="ppt-bar" />
      <div className="blob" style={{ width: 460, height: 460, right: -80, top: -170 }} />
      <div className="blob" style={{ width: 300, height: 300, right: -40, bottom: -90, background: "rgba(26,107,181,0.35)" }} />
      <div className="kicker">
        {payload.templateType === "biweekly" ? "BIWEEKLY REPORT" : "WEEKLY REPORT"}
      </div>
      <h2>{payload.title}</h2>
      <div className="rule" />
      <div className="meta">
        部门：{payload.department || "—"}　　日期：{payload.dateLabel}
        {payload.author ? `　　汇报人：${payload.author}` : ""}
      </div>
      <div className="fine">内部汇报 · 请勿外传</div>
    </div>
  );
}

function Toc({ payload, page, total }: { payload: TocPayload; page: number; total: number }) {
  return (
    <div className="ppt-toc" data-slide-type="toc">
      <div className="ppt-toc-left">
        <h2>目录</h2>
        <p>CONTENTS</p>
      </div>
      <div className="ppt-toc-right">
        {payload.items.map((item) => (
          <div className="toc-item" key={item.index}>
            <div className="num">{item.index}</div>
            <div>
              <h3>{item.title}</h3>
              <span>{item.en}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="ppt-footer">{page} / {total}</div>
    </div>
  );
}

function Part({ payload }: { payload: PartPayload }) {
  return (
    <div className="ppt-part" data-slide-type="part">
      <div className="ppt-bar" />
      <div className="kicker">PART</div>
      <div className="no">{payload.partNo}</div>
      <div className="rule" />
      <h2>{payload.title}</h2>
      <div className="en">{payload.en}</div>
    </div>
  );
}

function ProjectSlide({
  payload,
  page,
  total,
}: {
  payload: ProjectPayload;
  page: number;
  total: number;
}) {
  const title = `${payload.ordinal}、${payload.name}${payload.continued ? "（续）" : ""}`;
  return (
    <div className="ppt-page" data-slide-type="project">
      <div className="ppt-top">
        {title}
        {payload.status ? (
          <span className="badge" style={{ marginLeft: 16, fontSize: 14 }}>
            {PROJECT_STATUS_LABEL[payload.status]}
          </span>
        ) : null}
      </div>
      <div className="ppt-body">
        {payload.bullets.map((b, i) => (
          <div className="bullet-card" key={`${i}-${b.slice(0, 12)}`}>
            <div className="n-circle">{i + 1}</div>
            <p>{b}</p>
          </div>
        ))}
      </div>
      <div className="ppt-footer">{page} / {total}</div>
    </div>
  );
}

function Issues({ payload, page, total }: { payload: IssuesPayload; page: number; total: number }) {
  return (
    <div className="ppt-page" data-slide-type="issues">
      <div className="ppt-top">存在问题与建议</div>
      {payload.empty ? (
        <div className="ppt-na">
          <div>
            <strong>N/A</strong>
            <p>本期无问题与建议</p>
          </div>
        </div>
      ) : (
        <div className="ppt-body">
          {payload.items.map((item, i) => (
            <div className="bullet-card" key={`${i}-${item.slice(0, 12)}`}>
              <div className="n-circle">{i + 1}</div>
              <p>{item}</p>
            </div>
          ))}
        </div>
      )}
      <div className="ppt-footer">{page} / {total}</div>
    </div>
  );
}

function Plan({ payload, page, total }: { payload: PlanPayload; page: number; total: number }) {
  return (
    <div className="ppt-page" data-slide-type="plan">
      <div className="ppt-top">下周工作计划</div>
      <div className="ppt-body">
        <table className="ppt-table">
          <thead>
            <tr>
              <th>项目</th>
              <th>工作内容</th>
            </tr>
          </thead>
          <tbody>
            {payload.rows.map((row) => (
              <tr key={row.projectName}>
                <td className="proj">{row.projectName}</td>
                <td>
                  {row.items.map((item, i) => (
                    <div key={i}>{i + 1}. {item}</div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ppt-footer">{page} / {total}</div>
    </div>
  );
}

function Closing({ payload }: { payload: ClosingPayload }) {
  return (
    <div className="ppt-close" data-slide-type="closing">
      <div className="ppt-bar" />
      <h2>{payload.message}</h2>
      <div className="rule" />
      <div className="en">Thank you</div>
      {payload.department ? <div className="dept">{payload.department}</div> : null}
    </div>
  );
}
