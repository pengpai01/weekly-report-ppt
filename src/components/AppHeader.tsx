import { Link } from "react-router-dom";
import { useLayoutEffect, useRef, type ReactNode } from "react";

export function AppHeader({ right }: { right?: ReactNode }) {
  const headerRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const apply = () => {
      document.documentElement.style.setProperty("--app-header-height", `${el.offsetHeight}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <header ref={headerRef} className="app-header">
      <Link to="/" className="brand">
        <span className="brand-mark">报</span>
        汇报助手
      </Link>
      {right ?? <div className="header-note">草稿保存在本机服务，刷新后可继续</div>}
    </header>
  );
}

export function Stepper({ current }: { current: 1 | 2 | 3 }) {
  const steps = [
    { n: 1, t: "元信息" },
    { n: 2, t: "录入素材" },
    { n: 3, t: "预览导出" },
  ];
  return (
    <div className="stepper">
      {steps.map((s) => (
        <div key={s.n} className={`step${current === s.n ? " active" : ""}`}>
          <b>步骤 {s.n}/3</b>
          {s.t}
        </div>
      ))}
    </div>
  );
}
