import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Report } from "./types";
import { createReport } from "./lib/report";
import {
  confirmIngestPreview,
  createReportOnServer,
  deleteReportOnServer,
  getReport as fetchReport,
  importYunxiaoWorkItems,
  listReports,
  updateReportOnServer,
} from "./lib/api";

const STORAGE_KEY = "weekly-report-ppt:v1";
const SAVE_DEBOUNCE_MS = 400;

function readCache(): Report[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Report[]) : [];
  } catch {
    return [];
  }
}

function writeCache(reports: Report[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
  } catch {
    // quota / private mode — server remains the source of truth
  }
}

async function hydrateFromServer(): Promise<Report[]> {
  const remote = await listReports();
  if (remote.length > 0) return remote;
  const local = readCache();
  if (local.length === 0) return remote;
  for (const draft of local) {
    try {
      await createReportOnServer(draft);
    } catch {
      // already on server or rejected — keep going
    }
  }
  return listReports();
}

interface StoreValue {
  reports: Report[];
  ready: boolean;
  error: string | null;
  getReport: (id: string) => Report | undefined;
  loadById: (id: string) => Promise<Report | undefined>;
  upsert: (report: Report) => void;
  patch: (id: string, updater: (report: Report) => Report) => Report | undefined;
  remove: (id: string) => Promise<void>;
  create: (partial?: Partial<Report>) => Promise<Report>;
  importFromYunxiao: (itemIds: string[], reportPartial?: Partial<Report>) => Promise<Report>;
  importFromUpload: (previewId: string, reportPartial?: Partial<Report>) => Promise<Report>;
  saveNow: (id?: string) => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function ReportProvider({ children }: { children: ReactNode }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reportsRef = useRef<Report[]>([]);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const savesRef = useRef(new Map<string, Promise<void>>());

  const commit = useCallback((next: Report[]) => {
    reportsRef.current = next;
    setReports(next);
    writeCache(next);
  }, []);

  const persistOne = useCallback((id: string) => {
    const pending = savesRef.current.get(id) ?? Promise.resolve();
    const next = pending
      .catch(() => undefined)
      .then(async () => {
        const report = reportsRef.current.find((r) => r.id === id);
        if (!report) return;
        await updateReportOnServer(id, report);
      });
    savesRef.current.set(id, next);
    return next;
  }, []);

  const saveNow = useCallback(
    async (id?: string) => {
      const ids = id
        ? [id]
        : [...new Set([...timersRef.current.keys(), ...savesRef.current.keys()])];
      for (const target of ids) {
        const timer = timersRef.current.get(target);
        if (timer) {
          clearTimeout(timer);
          timersRef.current.delete(target);
        }
      }
      await Promise.all(ids.map((target) => persistOne(target)));
    },
    [persistOne],
  );

  const scheduleSave = useCallback(
    (id: string) => {
      const prev = timersRef.current.get(id);
      if (prev) clearTimeout(prev);
      timersRef.current.set(
        id,
        setTimeout(() => {
          timersRef.current.delete(id);
          void persistOne(id).catch((err) => {
            setError(err instanceof Error ? err.message : "保存失败");
          });
        }, SAVE_DEBOUNCE_MS),
      );
    },
    [persistOne],
  );

  useEffect(() => {
    let cancelled = false;
    void hydrateFromServer()
      .then((list) => {
        if (cancelled) return;
        commit(list);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        const cached = readCache();
        commit(cached);
        setError(
          cached.length
            ? "无法连接本机服务，正在使用本地缓存。启动服务后刷新即可同步。"
            : err instanceof Error
              ? err.message
              : "无法读取本机草稿服务",
        );
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [commit]);

  useEffect(() => {
    const flush = () => {
      void saveNow();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      void saveNow();
    };
  }, [saveNow]);

  const getReport = useCallback(
    (id: string) => reports.find((r) => r.id === id),
    [reports],
  );

  const loadById = useCallback(
    async (id: string) => {
      const existing = reportsRef.current.find((r) => r.id === id);
      if (existing) return existing;
      try {
        const report = await fetchReport(id);
        commit([report, ...reportsRef.current.filter((r) => r.id !== report.id)]);
        return report;
      } catch {
        return undefined;
      }
    },
    [commit],
  );

  const upsert = useCallback(
    (report: Report) => {
      const nextReport = { ...report, updatedAt: new Date().toISOString() };
      const prev = reportsRef.current;
      const idx = prev.findIndex((r) => r.id === nextReport.id);
      const next =
        idx === -1
          ? [nextReport, ...prev]
          : prev.map((r, i) => (i === idx ? nextReport : r));
      commit(next);
      scheduleSave(nextReport.id);
    },
    [commit, scheduleSave],
  );

  const patch = useCallback(
    (id: string, updater: (report: Report) => Report) => {
      let updated: Report | undefined;
      const next = reportsRef.current.map((r) => {
        if (r.id !== id) return r;
        updated = { ...updater(r), updatedAt: new Date().toISOString() };
        return updated;
      });
      if (!updated) return undefined;
      commit(next);
      scheduleSave(id);
      return updated;
    },
    [commit, scheduleSave],
  );

  const remove = useCallback(
    async (id: string) => {
      const timer = timersRef.current.get(id);
      if (timer) {
        clearTimeout(timer);
        timersRef.current.delete(id);
      }
      await deleteReportOnServer(id);
      commit(reportsRef.current.filter((r) => r.id !== id));
    },
    [commit],
  );

  const create = useCallback(
    async (partial?: Partial<Report>) => {
      const report = createReport(partial);
      const saved = await createReportOnServer(report);
      commit([saved, ...reportsRef.current.filter((r) => r.id !== saved.id)]);
      setError(null);
      return saved;
    },
    [commit],
  );

  const commitImported = useCallback(
    (saved: Report) => {
      if (!saved?.id) {
        throw new Error("导入成功但未返回草稿编号。");
      }
      const report: Report = {
        ...saved,
        projects: saved.projects ?? [],
        issues: saved.issues ?? { empty: true, items: [] },
        nextWeek: saved.nextWeek ?? [],
        slides: saved.slides ?? [],
        status: saved.status ?? "draft",
      };
      commit([report, ...reportsRef.current.filter((r) => r.id !== report.id)]);
      setError(null);
      return report;
    },
    [commit],
  );

  const importFromYunxiao = useCallback(
    async (itemIds: string[], reportPartial?: Partial<Report>) => {
      const saved = await importYunxiaoWorkItems(itemIds, reportPartial);
      return commitImported(saved);
    },
    [commitImported],
  );

  const importFromUpload = useCallback(
    async (previewId: string, reportPartial?: Partial<Report>) => {
      const saved = await confirmIngestPreview(previewId, reportPartial);
      return commitImported(saved);
    },
    [commitImported],
  );

  const value = useMemo(
    () => ({
      reports,
      ready,
      error,
      getReport,
      loadById,
      upsert,
      patch,
      remove,
      create,
      importFromYunxiao,
      importFromUpload,
      saveNow,
    }),
    [
      reports,
      ready,
      error,
      getReport,
      loadById,
      upsert,
      patch,
      remove,
      create,
      importFromYunxiao,
      importFromUpload,
      saveNow,
    ],
  );

  return createElement(StoreContext.Provider, { value }, children);
}

export function useReports() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useReports must be used within ReportProvider");
  return ctx;
}

export function useReport(id: string | undefined) {
  const { getReport, ready, error, loadById } = useReports();
  const [lookupDone, setLookupDone] = useState(false);
  const report = id ? getReport(id) : undefined;

  useEffect(() => {
    if (!id || !ready) {
      setLookupDone(false);
      return;
    }
    if (report) {
      setLookupDone(true);
      return;
    }
    let cancelled = false;
    void loadById(id).finally(() => {
      if (!cancelled) setLookupDone(true);
    });
    return () => {
      cancelled = true;
    };
  }, [id, ready, report, loadById]);

  return {
    report,
    ready: Boolean(id) && ready && (Boolean(report) || lookupDone),
    error,
  };
}
