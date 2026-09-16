import { useEffect, useRef, type ReactNode } from "react";

export function SlideFrame({
  children,
  mini = false,
}: {
  children: ReactNode;
  mini?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const apply = () => {
      el.style.setProperty("--slide-scale", String(el.clientWidth / 1280));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className={`slide-frame${mini ? " mini" : ""}`} ref={host}>
      <div
        className="slide-canvas"
        style={{ transform: "scale(var(--slide-scale, 1))" }}
      >
        {children}
      </div>
    </div>
  );
}
