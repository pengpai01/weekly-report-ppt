import type { ReactNode } from "react";
import { AppHeader } from "./AppHeader";
import { useReport } from "../store";
import type { Report } from "../types";

export function ReportGate({
  id,
  children,
}: {
  id: string | undefined;
  children: (report: Report) => ReactNode;
}) {
  const { report, ready, error } = useReport(id);

  if (!ready) {
    return (
      <>
        <AppHeader />
        <div className="page">
          <div className="panel">{error ?? "正在从本机服务读取草稿…"}</div>
        </div>
      </>
    );
  }

  if (!report) {
    return (
      <>
        <AppHeader />
        <div className="page">
          <div className="panel">{error ?? "找不到这份草稿。"}</div>
        </div>
      </>
    );
  }

  return children(report);
}
