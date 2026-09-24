import { useEffect, useMemo, useState } from "react";
import { listYunxiaoWorkItems, yunxiaoErrorMessage } from "../lib/api";
import { buildZoneSnapshot } from "../lib/importZones";
import type { ImportMergeOptions, ZoneSnapshot } from "../lib/zoneMerge";
import type { YunxiaoWorkItem } from "../types";
import { AutoMergeToggle, ZoneMergePanel } from "./ZoneMergePanel";

const UPDATED_WITHIN_DAYS = 14;

function formatUpdatedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

function metaLine(item: YunxiaoWorkItem): string {
  return [item.module, item.assignee, item.sprint, item.updatedAt ? formatUpdatedAt(item.updatedAt) : ""]
    .filter((part) => part && String(part).trim())
    .join(" · ");
}

export function YunxiaoImportModal({
  open,
  busy,
  onClose,
  onImport,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onImport: (itemIds: string[], options: ImportMergeOptions) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<YunxiaoWorkItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);
  const [autoMerge, setAutoMerge] = useState(true);
  const [manual, setManual] = useState<{ key: string; zones: ZoneSnapshot } | null>(null);

  useEffect(() => {
    if (!open) {
      setItems([]);
      setSelected(new Set());
      setError(null);
      setLoading(false);
      setAutoMerge(true);
      setManual(null);
      return;
    }

    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setSelected(new Set());
    setAutoMerge(true);
    setManual(null);
    void listYunxiaoWorkItems(UPDATED_WITHIN_DAYS, { signal: ac.signal })
      .then((body) => {
        if (!body || !Array.isArray(body.items)) {
          throw new Error("云效返回数据格式不正确。");
        }
        setItems(body.items);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setItems([]);
        setError(yunxiaoErrorMessage(err, "无法读取云效工作项。"));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });

    return () => ac.abort();
  }, [open, reloadKey]);

  const allSelected = items.length > 0 && selected.size === items.length;
  const selectedIds = useMemo(() => [...selected], [selected]);
  const selectedItems = useMemo(
    () =>
      items
        .filter((item) => selected.has(item.id))
        .map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          category: item.category,
          module: item.module,
          assignee: item.assignee,
        })),
    [items, selected],
  );
  const previewKey = `${selectedIds.join("\0")}:${autoMerge ? "1" : "0"}`;
  const edited = manual?.key === previewKey ? manual.zones : null;
  const zones = edited ?? buildZoneSnapshot(selectedItems, autoMerge);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)));
  };

  const confirmImport = async () => {
    if (!selectedIds.length || busy) return;
    setError(null);
    try {
      await onImport(selectedIds, {
        moduleAutoMerge: autoMerge,
        zones: edited ?? undefined,
      });
    } catch (err) {
      setError(yunxiaoErrorMessage(err, "导入失败，请稍后重试。"));
    }
  };

  if (!open) return null;

  return (
    <div className="overlay" onClick={() => !busy && onClose()}>
      <div className="modal yunxiao-modal" onClick={(e) => e.stopPropagation()}>
        <h3>从云效导入</h3>
        <p className="hint">
          列出近 {UPDATED_WITHIN_DAYS} 天更新的工作项，勾选后在下方预览草稿。可在同一分区内合并条目。云效凭证只保存在本机服务，不会出现在浏览器。
        </p>

        {error ? <div className="error">{error}</div> : null}

        {loading ? (
          <div className="panel empty" style={{ boxShadow: "none" }}>正在读取云效工作项…</div>
        ) : error && items.length === 0 ? (
          <div className="panel empty" style={{ boxShadow: "none" }}>未能加载工作项。可重试，或稍后再试。</div>
        ) : items.length === 0 ? (
          <div className="panel empty" style={{ boxShadow: "none" }}>
            近 {UPDATED_WITHIN_DAYS} 天没有可导入的工作项。
          </div>
        ) : (
          <>
            <div className="workitem-toolbar">
              <label>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={busy} />
                全选
              </label>
              <span>已选 {selected.size} / {items.length}</span>
            </div>
            <div className="workitem-list">
              {items.map((item) => {
                const checked = selected.has(item.id);
                const extra = metaLine(item);
                return (
                  <label key={item.id} className={`workitem-row${checked ? " selected" : ""}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy}
                      onChange={() => toggle(item.id)}
                    />
                    <div>
                      <h3>{item.title || "未命名工作项"}</h3>
                      <div className="workitem-tags">
                        {item.category ? <span className="badge">{item.category}</span> : null}
                        {item.status ? <span className="badge badge-gold">{item.status}</span> : null}
                      </div>
                      {extra ? <p>{extra}</p> : null}
                    </div>
                  </label>
                );
              })}
            </div>
          </>
        )}

        {selectedIds.length > 0 ? (
          <div className="import-preview">
            <h4>草稿预览</h4>
            <p className="hint">
              {edited
                ? "已按你的调整预览。确认后按此内容写入草稿。"
                : "未改预览时，确认后以服务端映射为准（含去重）。开启「按模块自动归并」时，相近模块名合并，短名包含于长名则保留较长正式名。"}
            </p>
            <ZoneMergePanel
              scrollable
              resetKey={previewKey}
              value={zones}
              onChange={(next) => setManual({ key: previewKey, zones: next })}
            />
          </div>
        ) : null}

        <div className="footer-bar">
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>
            取消
          </button>
          <div className="confirm-actions">
            <AutoMergeToggle checked={autoMerge} disabled={busy || loading} onChange={setAutoMerge} />
            <button
              className="btn btn-ghost"
              disabled={busy || loading}
              onClick={() => setReloadKey((n) => n + 1)}
            >
              重新加载
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || loading || selectedIds.length === 0}
              onClick={() => void confirmImport()}
            >
              {busy ? "正在导入…" : `导入所选（${selectedIds.length}）`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
