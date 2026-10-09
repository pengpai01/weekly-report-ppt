import { useState } from "react";
import { deleteReportImage, uploadReportImage } from "../lib/api";
import {
  COVER_IMAGE_SLOTS,
  clientImageError,
  imageErrorMessage,
  imagePreviewUrl,
  type ImageSlotId,
} from "../lib/reportImages";
import type { ReportImage } from "../types";

export function CoverImageSlots({
  reportId,
  images,
  onImages,
}: {
  reportId: string;
  images: ReportImage[];
  onImages: (images: ReportImage[]) => void;
}) {
  const [error, setError] = useState("");
  const [busySlot, setBusySlot] = useState<string | null>(null);

  const upload = async (slot: ImageSlotId, file: File | undefined) => {
    if (!file || busySlot) return;
    const localError = clientImageError(file);
    if (localError) {
      setError(localError);
      return;
    }
    setError("");
    setBusySlot(slot);
    try {
      const result = await uploadReportImage(reportId, slot, file);
      onImages(result.images);
    } catch (err) {
      setError(imageErrorMessage(err));
    } finally {
      setBusySlot(null);
    }
  };

  const remove = async (image: ReportImage) => {
    if (busySlot) return;
    setError("");
    setBusySlot(image.slot);
    try {
      const result = await deleteReportImage(reportId, image.id);
      onImages(result.images);
    } catch (err) {
      setError(imageErrorMessage(err));
    } finally {
      setBusySlot(null);
    }
  };

  return (
    <section className="cover-image-slots">
      <h3>封面配图</h3>
      <p className="hint">
        对应模板封面三块拼图（左上、中部、右上）。结束页沿用同一组图。未上传的槽保持模板原图。支持 PNG、JPEG、GIF、WEBP，单张不超过 4MB。上传失败不会改动项目、问题或下周计划。
      </p>
      {error ? <div className="error">{error}</div> : null}
      <div className="image-slot-grid">
        {COVER_IMAGE_SLOTS.map((slot) => {
          const image = images.find((item) => item.slot === slot.id);
          const busy = busySlot === slot.id;
          return (
            <div key={slot.id} className="image-slot">
              <strong>{slot.label}</strong>
              {image ? (
                <img src={imagePreviewUrl(reportId, image)} alt={slot.label} />
              ) : (
                <div className="slot-empty">使用模板原图</div>
              )}
              <label className="btn btn-ghost btn-sm">
                {busy ? "处理中…" : image ? "更换图片" : "上传图片"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp"
                  disabled={Boolean(busySlot)}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void upload(slot.id, file);
                  }}
                />
              </label>
              {image ? (
                <button className="btn btn-ghost btn-sm" type="button" disabled={Boolean(busySlot)} onClick={() => void remove(image)}>
                  移除
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
