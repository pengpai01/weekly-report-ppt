import { useEffect, useRef, useState } from "react";
import {
  cancelIngestPreview,
  ingestErrorMessage,
  uploadIngestFile,
  type IngestPreview,
  type IngestPreviewRow,
} from "../lib/api";
import {
  INGEST_ACCEPT,
  INGEST_MAX_UPLOAD_BYTES,
  INGEST_TEMPLATE_CSV,
  INGEST_TEMPLATE_XLSX,
  YUNZHIJIA_NOTE,
} from "../lib/ingestCopy";

function isSpreadsheetName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return lower.endsWith(".xlsx") || lower.endsWith(".csv");
}

function cell(value?: string): string {
  return value?.trim() ? value : "—";
}

export function IngestUploadModal({
  open,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (previewId: string) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<IngestPreview | null>(null);

  useEffect(() => {
    if (open) return;
    setFile(null);
    setError(null);
    setPreview(null);
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }, [open]);

  const discardPreview = (previewId?: string) => {
    if (!previewId) return;
    void cancelIngestPreview(previewId).catch(() => undefined);
  };

  const close = () => {
    if (busy || uploading) return;
    discardPreview(preview?.previewId);
    onClose();
  };

  const chooseFile = (next: File | null) => {
    setError(null);
    if (!next) {
      setFile(null);
      return;
    }
    if (!isSpreadsheetName(next.name)) {
      setFile(null);
      setError("请上传 .xlsx 或 .csv 文件。");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (next.size > INGEST_MAX_UPLOAD_BYTES) {
      setFile(null);
      setError("文件过大，请压缩或删减行后再上传。");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setFile(next);
  };

  const upload = async () => {
    if (!file || uploading || busy) return;
    setUploading(true);
    setError(null);
    const previousId = preview?.previewId;
    try {
      const next = await uploadIngestFile(file, file.name);
      if (!next?.previewId || !Array.isArray(next.rows) || !next.summary) {
        throw new Error("上传成功但返回数据格式不正确。");
      }
      discardPreview(previousId);
      setPreview(next);
    } catch (err) {
      setError(ingestErrorMessage(err, "上传失败，请检查文件后重试。"));
    } finally {
      setUploading(false);
    }
  };

  const confirm = async () => {
    if (!preview?.previewId || busy || uploading) return;
    if (preview.summary.ok < 1) {
      setError("没有可导入的成功行。请修正错误后重新上传。");
      return;
    }
    setError(null);
    try {
      await onConfirm(preview.previewId);
    } catch (err) {
      setError(ingestErrorMessage(err, "确认导入失败，请稍后重试。"));
    }
  };

  if (!open) return null;

  return (
    <div className="overlay" onClick={close}>
      <div className="modal ingest-modal" onClick={(e) => e.stopPropagation()}>
        <h3>上传表格导入</h3>
        <p className="hint">
          必填列：事项标题、状态。可选：模块、负责人、详情、计划日期、来源ID。确认后错误行不会写入周报正文。
        </p>

        <aside className="ingest-note" aria-label="云之家">
          <strong>云之家</strong>
          {YUNZHIJIA_NOTE.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </aside>

        <div className="ingest-toolbar">
          <div className="ingest-downloads">
            下载模板
            <a className="btn btn-ghost btn-sm" href={INGEST_TEMPLATE_XLSX} download>
              Excel（xlsx）
            </a>
            <a className="btn btn-ghost btn-sm" href={INGEST_TEMPLATE_CSV} download>
              CSV
            </a>
          </div>
          <div className="ingest-pick">
            <input
              ref={inputRef}
              type="file"
              accept={INGEST_ACCEPT}
              disabled={busy || uploading}
              onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
            />
            <button
              className="btn btn-secondary btn-sm"
              disabled={busy || uploading || !file}
              onClick={() => void upload()}
            >
              {uploading ? "正在上传…" : "上传预览"}
            </button>
          </div>
        </div>
        {file ? <p className="ingest-filename">已选：{file.name}</p> : null}

        {error ? <div className="error">{error}</div> : null}

        {preview ? (
          <>
            <div className="ingest-summary">
              共 {preview.summary.total} 行，成功 {preview.summary.ok}，错误 {preview.summary.error}
            </div>
            {preview.rows.length === 0 ? (
              <div className="panel empty" style={{ boxShadow: "none" }}>
                文件没有可预览的数据行。
              </div>
            ) : (
              <div className="ingest-table-wrap">
                <table className="ingest-table">
                  <thead>
                    <tr>
                      <th>行</th>
                      <th>事项标题</th>
                      <th>状态</th>
                      <th>模块</th>
                      <th>负责人</th>
                      <th>详情</th>
                      <th>计划日期</th>
                      <th>来源ID</th>
                      <th>校验</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <PreviewRow key={`${row.row}-${row.sourceId ?? ""}-${row.title}`} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div className="panel empty" style={{ boxShadow: "none" }}>
            下载模板填写后选择文件，再点「上传预览」。
          </div>
        )}

        <div className="footer-bar">
          <button className="btn btn-ghost" disabled={busy || uploading} onClick={close}>
            取消
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || uploading || !preview || preview.summary.ok < 1}
            onClick={() => void confirm()}
          >
            {busy ? "正在导入…" : "确认导入"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewRow({ row }: { row: IngestPreviewRow }) {
  return (
    <tr className={row.ok ? undefined : "ingest-row-error"}>
      <td>{row.row}</td>
      <td>{cell(row.title)}</td>
      <td>{cell(row.status)}</td>
      <td>{cell(row.module)}</td>
      <td>{cell(row.owner)}</td>
      <td>{cell(row.detail)}</td>
      <td>{cell(row.planDate)}</td>
      <td>{cell(row.sourceId)}</td>
      <td>{row.ok ? "通过" : row.error || "未通过"}</td>
    </tr>
  );
}
