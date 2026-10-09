import type { Report, ReportImage } from "../types";

/**
 * The official template has three mosaic tiles (shape ids 6 / 8 / 11).
 * Cover (`slide1`) and closing (`slide3`) both embed them via rId3 / rId4 / rId5.
 * Empty slots keep the template art. The cover logo (image1.png) is not a slot.
 */
export const COVER_IMAGE_SLOTS = [
  { id: "cover-1", label: "封面左上", relId: "rId3", shapeId: "6" },
  { id: "cover-2", label: "封面中部", relId: "rId4", shapeId: "8" },
  { id: "cover-3", label: "封面右上", relId: "rId5", shapeId: "11" },
] as const;

export type ImageSlotId = (typeof COVER_IMAGE_SLOTS)[number]["id"];

export type SlotImageBytes = {
  slot: ImageSlotId;
  mime: string;
  bytes: Uint8Array;
};

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const ALLOWED_MIME = new Set(Object.keys(MIME_EXT));

export function extensionForMime(mime: string): string {
  return MIME_EXT[mime] || "bin";
}

export function isImageSlotId(slot: string): slot is ImageSlotId {
  return COVER_IMAGE_SLOTS.some((item) => item.id === slot);
}

/** Local reject before any request. A hit here does not touch the draft. */
export function clientImageError(file: { name: string; type: string; size: number }): string | null {
  const name = file.name.toLowerCase();
  const extOk = /\.(png|jpe?g|gif|webp)$/.test(name);
  const type = file.type.trim().toLowerCase();
  const typeOk = type === "" || ALLOWED_MIME.has(type);
  if (!extOk || !typeOk) {
    return "不支持的图片格式。请上传 PNG、JPEG、GIF 或 WEBP。草稿未改动。";
  }
  if (file.size <= 0) return "图片文件是空的。草稿未改动。";
  if (file.size > MAX_IMAGE_BYTES) return "图片超过 4MB。请压缩后再上传。草稿未改动。";
  return null;
}

export function imageErrorMessage(err: unknown): string {
  const error = err instanceof Error ? err : null;
  const code = error && "code" in error ? String((error as { code?: string }).code || "") : "";
  const status = error && "status" in error ? Number((error as { status?: number }).status) : 0;
  const message = error?.message?.trim() || "";
  if (code === "image.unsupported" || /不支持的图片格式/.test(message)) {
    return "不支持的图片格式。请上传 PNG、JPEG、GIF 或 WEBP。草稿未改动。";
  }
  if (code === "image.slot") return message || "未知的图片槽。草稿未改动。";
  if (code === "image.too_large" || status === 413 || /upload exceeds/i.test(message)) {
    return "图片超过 4MB。请压缩后再上传。草稿未改动。";
  }
  if (code === "access.forbidden" || status === 403) {
    return "图片接口只允许本机访问。草稿未改动。";
  }
  if (/missing multipart|malformed multipart|expected multipart/i.test(message)) {
    return "图片上传内容不正确。请重新选择文件。草稿未改动。";
  }
  if (error?.name === "TypeError") return "无法连接本机服务。草稿未改动。";
  if (message) return `${message} 草稿未改动。`;
  return "图片上传失败。草稿未改动。";
}

export async function fetchSlotImages(report: Report): Promise<SlotImageBytes[]> {
  const images = (report.images ?? []).filter((image) => isImageSlotId(image.slot));
  return Promise.all(
    images.map(async (image) => {
      const res = await fetch(
        `/api/reports/${encodeURIComponent(report.id)}/images/${encodeURIComponent(image.id)}`,
      );
      if (!res.ok) {
        let message = "配图读取失败，草稿未改动。";
        try {
          const body = await res.json();
          if (typeof body?.error === "string" && body.error.trim()) message = `${body.error} 草稿未改动。`;
        } catch {
          // non-JSON error body
        }
        throw new Error(message);
      }
      return {
        slot: image.slot,
        mime: image.mime || res.headers.get("content-type") || "image/png",
        bytes: new Uint8Array(await res.arrayBuffer()),
      };
    }),
  );
}

export function imagePreviewUrl(reportId: string, image: ReportImage): string {
  return `/api/reports/${encodeURIComponent(reportId)}/images/${encodeURIComponent(image.id)}`;
}
