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

export function SlideView({
  slide,
  page,
  total,
  brand,
}: {
  slide: Slide;
  page: number;
  total: number;
  brand?: { department: string; title: string };
}) {
  switch (slide.type) {
    case "cover":
      return <Cover payload={as<CoverPayload>(slide.payload)} />;
    case "toc":
      return <Toc payload={as<TocPayload>(slide.payload)} page={page} total={total} brand={brand} />;
    case "part":
      return <Part payload={as<PartPayload>(slide.payload)} />;
    case "project":
      return <ProjectSlide payload={as<ProjectPayload>(slide.payload)} page={page} total={total} brand={brand} />;
    case "issues":
      return <Issues payload={as<IssuesPayload>(slide.payload)} page={page} total={total} brand={brand} />;
    case "plan":
      return <Plan payload={as<PlanPayload>(slide.payload)} page={page} total={total} brand={brand} />;
    case "closing":
      return <Closing payload={as<ClosingPayload>(slide.payload)} />;
  }
}

function Footer({
  page,
  total,
  brand,
}: {
  page: number;
  total: number;
  brand?: { department: string; title: string };
}) {
  const label = [brand?.department, brand?.title].filter((s) => s?.trim()).join("  ·  ");
  return (
    <div className="ppt-footer">
      {label ? <span className="ppt-footer-brand">{label}</span> : <span />}
      <span>{String(page).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
    </div>
  );
}

function Cover({ payload }: { payload: CoverPayload }) {
  const cells = [
    { label: "部门", value: payload.department || "—" },
    { label: "日期", value: payload.dateLabel || "—" },
  ];
  if (payload.author) cells.push({ label: "汇报人", value: payload.author });
  return (
    <div className="ppt-cover" data-slide-type="cover">
      <div className="ppt-bar" />
      <div className="blob" style={{ width: 460, height: 460, right: -80, top: -170 }} />
      <div className="blob" style={{ width: 300, height: 300, right: -40, bottom: -90, background: "rgba(26,107,181,0.35)" }} />
      <div className="kicker">
        <i />
        {payload.templateType === "biweekly" ? "BIWEEKLY REPORT  ·  双周报" : "WEEKLY REPORT  ·  周报"}
      </div>
      <h2>{payload.title}</h2>
      <div className="rule" />
      <div className="info-strip">
        {cells.map((cell, i) => (
          <div className="info-cell" key={cell.label}>
            {i > 0 ? <span className="info-split" /> : null}
            <small>{cell.label}</small>
            <b>{cell.value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function Toc({
  payload,
  page,
  total,
  brand,
}: {
  payload: TocPayload;
  page: number;
  total: number;
  brand?: { department: string; title: string };
}) {
  return (
    <div className="ppt-toc" data-slide-type="toc">
      <div className="ppt-toc-left">
        <i className="toc-diamond" />
        <h2>目录</h2>
        <p>CONTENTS</p>
        <div className="rule" />
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
      <Footer page={page} total={total} brand={brand} />
    </div>
  );
}

function Part({ payload }: { payload: PartPayload }) {
  return (
    <div className="ppt-part" data-slide-type="part">
      <div className="ppt-bar" />
      <div className="watermark">{payload.partNo}</div>
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
  brand,
}: {
  payload: ProjectPayload;
  page: number;
  total: number;
  brand?: { department: string; title: string };
}) {
  const title = `${payload.ordinal}、${payload.name}${payload.continued ? "（续）" : ""}`;
  return (
    <div className="ppt-page" data-slide-type="project">
      <div className="ppt-top">
        <span>{title}</span>
        {payload.status ? <span className="ppt-status">{PROJECT_STATUS_LABEL[payload.status]}</span> : null}
      </div>
      <div className="ppt-body">
        {payload.bullets.map((b, i) => (
          <div className="bullet-card" key={`${i}-${b.slice(0, 12)}`}>
            <div className="n-circle">{payload.bulletOffset + i + 1}</div>
            <p>{b}</p>
          </div>
        ))}
      </div>
      <Footer page={page} total={total} brand={brand} />
    </div>
  );
}

function Issues({
  payload,
  page,
  total,
  brand,
}: {
  payload: IssuesPayload;
  page: number;
  total: number;
  brand?: { department: string; title: string };
}) {
  return (
    <div className="ppt-page" data-slide-type="issues">
      <div className="ppt-top">存在问题与建议</div>
      {payload.empty ? (
        <div className="ppt-na">
          <div className="ppt-na-box">
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
      <Footer page={page} total={total} brand={brand} />
    </div>
  );
}

function Plan({
  payload,
  page,
  total,
  brand,
}: {
  payload: PlanPayload;
  page: number;
  total: number;
  brand?: { department: string; title: string };
}) {
  return (
    <div className="ppt-page" data-slide-type="plan">
      <div className="ppt-top">下周工作计划</div>
      <div className="ppt-body">
        <table className="ppt-table">
          <thead>
            <tr>
              <th className="idx">序号</th>
              <th>项目</th>
              <th>工作内容</th>
            </tr>
          </thead>
          <tbody>
            {payload.rows.map((row, i) => (
              <tr key={`${row.projectName}-${i}`}>
                <td className="idx">{i + 1}</td>
                <td className="proj">{row.projectName}</td>
                <td>
                  {row.items.map((item, j) => (
                    <div key={j}>{j + 1}. {item}</div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Footer page={page} total={total} brand={brand} />
    </div>
  );
}

function Closing({ payload }: { payload: ClosingPayload }) {
  return (
    <div className="ppt-close" data-slide-type="closing">
      <div className="ppt-bar" />
      <div className="kicker">END</div>
      <h2>{payload.message}</h2>
      <div className="rule" />
      <div className="en">Thank you</div>
      {payload.department ? <div className="dept">{payload.department}</div> : null}
    </div>
  );
}
