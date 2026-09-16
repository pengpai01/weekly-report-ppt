import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Report } from "./types";
import { createReport } from "./lib/report";

const STORAGE_KEY = "weekly-report-ppt:v1";

function loadReports(): Report[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Report[]) : [];
  } catch {
    return [];
  }
}

function persist(reports: Report[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
}

interface StoreValue {
  reports: Report[];
  getReport: (id: string) => Report | undefined;
  upsert: (report: Report) => void;
  patch: (id: string, updater: (report: Report) => Report) => Report | undefined;
  remove: (id: string) => void;
  create: (partial?: Partial<Report>) => Report;
}

const StoreContext = createContext<StoreValue | null>(null);

export function ReportProvider({ children }: { children: ReactNode }) {
  const [reports, setReports] = useState<Report[]>(() => loadReports());

  useEffect(() => {
    persist(reports);
  }, [reports]);

  const getReport = useCallback(
    (id: string) => reports.find((r) => r.id === id),
    [reports],
  );

  const upsert = useCallback((report: Report) => {
    setReports((prev) => {
      const next = { ...report, updatedAt: new Date().toISOString() };
      const idx = prev.findIndex((r) => r.id === next.id);
      if (idx === -1) return [next, ...prev];
      const copy = [...prev];
      copy[idx] = next;
      return copy;
    });
  }, []);

  const patch = useCallback((id: string, updater: (report: Report) => Report) => {
    let updated: Report | undefined;
    setReports((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        updated = { ...updater(r), updatedAt: new Date().toISOString() };
        return updated;
      }),
    );
    return updated;
  }, []);

  const remove = useCallback((id: string) => {
    setReports((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const create = useCallback((partial?: Partial<Report>) => {
    const report = createReport(partial);
    setReports((prev) => [report, ...prev]);
    return report;
  }, []);

  const value = useMemo(
    () => ({ reports, getReport, upsert, patch, remove, create }),
    [reports, getReport, upsert, patch, remove, create],
  );

  return createElement(StoreContext.Provider, { value }, children);
}

export function useReports() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useReports must be used within ReportProvider");
  return ctx;
}
