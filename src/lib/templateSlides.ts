/**
 * Reads a deck produced by fillOfficialTemplate and returns the shapes to paint.
 * Preview uses this model; it is parsed from the same bytes that export downloads.
 */
import JSZip from "jszip";

export const PREVIEW_W = 1280;
export const PREVIEW_H = 720;

export type FilledParagraph = {
  text: string;
  level: number;
  align: "left" | "center" | "right";
  fontSize: number;
  bold: boolean;
  color: string;
  bullet: boolean;
};

export type FilledShape = {
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  src?: string;
  line?: string;
  paragraphs?: FilledParagraph[];
};

export type FilledSlide = {
  shapes: FilledShape[];
};

const LEVEL_PT = [21.1, 19, 16.85, 14.75, 12.65];

function decode(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function relsPath(part: string): string {
  const slash = part.lastIndexOf("/");
  return `${part.slice(0, slash)}/_rels/${part.slice(slash + 1)}.rels`;
}

function resolveTarget(part: string, target: string): string {
  const base = part.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "..") base.pop();
    else if (segment !== ".") base.push(segment);
  }
  return base.join("/");
}

function parseRels(xml: string): { id: string; type: string; target: string }[] {
  const out: { id: string; type: string; target: string }[] = [];
  for (const match of xml.matchAll(/<Relationship\b([^>]*?)\/>/g)) {
    const attrs = match[1];
    const id = /Id="([^"]+)"/.exec(attrs)?.[1];
    const type = /Type="([^"]+)"/.exec(attrs)?.[1];
    const target = /Target="([^"]+)"/.exec(attrs)?.[1];
    if (id && type && target) out.push({ id, type, target });
  }
  return out;
}

function themeColors(xml: string): Record<string, string> {
  const map: Record<string, string> = {};
  const scheme = xml.match(/<a:clrScheme[\s\S]*?<\/a:clrScheme>/)?.[0] ?? "";
  for (const match of scheme.matchAll(/<a:(dk1|lt1|dk2|lt2|accent\d+)>([\s\S]*?)<\/a:\1>/g)) {
    const srgb = /srgbClr val="([0-9A-Fa-f]{6})"/.exec(match[2]);
    const last = /lastClr="([0-9A-Fa-f]{6})"/.exec(match[2]);
    if (srgb) map[match[1]] = `#${srgb[1]}`;
    else if (last) map[match[1]] = `#${last[1]}`;
  }
  map.bg1 = map.lt1 ?? "#FFFFFF";
  map.tx1 = map.dk1 ?? "#000000";
  map.bg2 = map.lt2 ?? "#E7E6E6";
  map.tx2 = map.dk2 ?? "#44546A";
  return map;
}

function dataUrl(bytes: Uint8Array, path: string): string {
  const mime = path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function imageMap(zip: JSZip, part: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const relsFile = zip.file(relsPath(part));
  if (!relsFile) return map;
  const rels = parseRels(await relsFile.async("string"));
  for (const rel of rels) {
    if (!rel.type.endsWith("/image")) continue;
    const mediaPath = resolveTarget(part, rel.target);
    const media = zip.file(mediaPath);
    if (!media) continue;
    map.set(rel.id, dataUrl(await media.async("uint8array"), mediaPath));
  }
  return map;
}

function blocks(xml: string, tag: "sp" | "pic" | "cxnSp"): string[] {
  return [...xml.matchAll(new RegExp(`<p:${tag}\\b[^>]*>[\\s\\S]*?<\\/p:${tag}>`, "g"))].map(
    (match) => match[0],
  );
}

function boxOf(shape: string): { x: number; y: number; cx: number; cy: number } | null {
  const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(shape);
  const ext = /<a:ext cx="(-?\d+)" cy="(-?\d+)"\/>/.exec(shape);
  if (!off || !ext) return null;
  return { x: Number(off[1]), y: Number(off[2]), cx: Number(ext[1]), cy: Number(ext[2]) };
}

function spPrHead(shape: string): string {
  const start = shape.indexOf("<p:spPr");
  if (start < 0) return shape;
  const end = shape.indexOf("</p:spPr>", start);
  const slice = shape.slice(start, end < 0 ? shape.length : end);
  const ext = slice.indexOf("<a:extLst");
  return ext >= 0 ? slice.slice(0, ext) : slice;
}

function fillOf(shape: string, theme: Record<string, string>): string | undefined {
  const head = spPrHead(shape);
  if (head.includes("<a:noFill") && !head.includes("<a:solidFill") && !head.includes("<a:blip")) {
    return undefined;
  }
  const srgb = /<a:solidFill>[\s\S]*?<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(head);
  if (srgb) return `#${srgb[1]}`;
  const scheme = /<a:solidFill>[\s\S]*?<a:schemeClr val="([^"]+)"/.exec(head);
  if (scheme) return theme[scheme[1]] ?? "#0070C0";
  return undefined;
}

function paragraphsOf(
  shape: string,
  theme: Record<string, string>,
  ptToPx: (pt: number) => number,
): FilledParagraph[] {
  const out: FilledParagraph[] = [];
  for (const match of shape.matchAll(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/g)) {
    const body = match[0];
    const text = [...body.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map((item) => decode(item[1])).join("");
    if (!text.trim()) continue;
    if (/单击此处|1ppt|第一PPT|PPT模板下载/i.test(text)) continue;
    const run = /<a:r\b[^>]*>[\s\S]*?<\/a:r>/.exec(body)?.[0] ?? "";
    const level = Number(/<a:pPr\b[^>]*\blvl="(\d+)"/.exec(body)?.[1] ?? 0);
    const alignAttr = /<a:pPr\b[^>]*\balgn="([^"]+)"/.exec(body)?.[1];
    const align = alignAttr === "ctr" ? "center" : alignAttr === "r" ? "right" : "left";
    const sz = Number(/<a:rPr\b[^>]*\bsz="(\d+)"/.exec(run)?.[1] ?? 0);
    const pt = sz > 0 ? sz / 100 : (LEVEL_PT[level] ?? 18);
    const runFill = /<a:solidFill>[\s\S]*?<\/a:solidFill>/.exec(run)?.[0] ?? "";
    const srgb = /srgbClr val="([0-9A-Fa-f]{6})"/.exec(runFill)?.[1];
    const scheme = /schemeClr val="([^"]+)"/.exec(runFill)?.[1];
    const color = srgb ? `#${srgb}` : scheme ? (theme[scheme] ?? theme.tx1 ?? "#222222") : (theme.tx1 ?? "#222222");
    out.push({
      text,
      level,
      align,
      fontSize: ptToPx(pt),
      bold: /<a:rPr\b[^>]*\bb="1"/.test(run),
      color: color.startsWith("#") ? color : `#${color}`,
      bullet: !body.includes("<a:buNone") && /<a:pPr\b[^>]*\blvl="/.test(body),
    });
  }
  return out;
}

function paintPart(
  xml: string,
  images: Map<string, string>,
  theme: Record<string, string>,
  scaleX: number,
  scaleY: number,
  ptToPx: (pt: number) => number,
  skipPlaceholders: boolean,
): FilledShape[] {
  const shapes: FilledShape[] = [];
  const tags = [...blocks(xml, "sp"), ...blocks(xml, "pic"), ...blocks(xml, "cxnSp")];
  for (const shape of tags) {
    if (skipPlaceholders && /<p:ph\b/.test(shape)) continue;
    const box = boxOf(shape);
    if (!box) continue;
    const x = box.x * scaleX;
    const y = box.y * scaleY;
    const w = box.cx * scaleX;
    const h = box.cy * scaleY;
    const blip = /<a:blip\b[^>]*r:embed="([^"]+)"/.exec(shape)?.[1];
    const src = blip ? images.get(blip) : undefined;
    const line = shape.startsWith("<p:cxnSp") || /prst="line"/.test(shape);
    if (line) {
      shapes.push({
        x,
        y,
        w: Math.max(w, 1),
        h: 0,
        line: theme.accent2 ?? theme.accent4 ?? "#00B0F0",
      });
      continue;
    }
    const paragraphs = paragraphsOf(shape, theme, ptToPx);
    const fill = src ? undefined : fillOf(shape, theme);
    if (!src && !fill && paragraphs.length === 0) continue;
    shapes.push({
      x,
      y,
      w: Math.max(w, 1),
      h: Math.max(h, 1),
      fill,
      src,
      paragraphs: paragraphs.length ? paragraphs : undefined,
    });
  }
  return shapes;
}

export async function parseFilledSlides(bytes: ArrayBuffer | Uint8Array): Promise<FilledSlide[]> {
  const zip = await JSZip.loadAsync(bytes);
  const presentation = await zip.file("ppt/presentation.xml")!.async("string");
  const sizeTag = /<p:sldSz\b([^>]*)\/?>/.exec(presentation)?.[1] ?? "";
  const cx = Number(/cx="(\d+)"/.exec(sizeTag)?.[1] ?? 12192000);
  const cy = Number(/cy="(\d+)"/.exec(sizeTag)?.[1] ?? 6858000);
  const scaleX = PREVIEW_W / cx;
  const scaleY = PREVIEW_H / cy;
  const ptToPx = (pt: number) => (pt * (PREVIEW_W / (cx / 914400))) / 72;
  const themeXml = await zip.file("ppt/theme/theme1.xml")!.async("string");
  const theme = themeColors(themeXml);
  const rels = parseRels(await zip.file("ppt/_rels/presentation.xml.rels")!.async("string"));
  const order = [...presentation.matchAll(/<p:sldId id="\d+" r:id="(rId\d+)"\/>/g)].map((match) => {
    const target = rels.find((rel) => rel.id === match[1])?.target;
    if (!target) throw new Error(`缺少幻灯片关系 ${match[1]}`);
    return resolveTarget("ppt/presentation.xml", target);
  });

  const slides: FilledSlide[] = [];
  for (const part of order) {
    const xml = await zip.file(part)!.async("string");
    const partRels = parseRels(await zip.file(relsPath(part))!.async("string"));
    const layoutTarget = partRels.find((rel) => rel.type.endsWith("/slideLayout"))?.target;
    const layoutPart = layoutTarget ? resolveTarget(part, layoutTarget) : "";
    const layoutXml = layoutPart ? await zip.file(layoutPart)!.async("string") : "";
    const layoutRels = layoutPart ? parseRels(await zip.file(relsPath(layoutPart))!.async("string")) : [];
    const masterTarget = layoutRels.find((rel) => rel.type.endsWith("/slideMaster"))?.target;
    const masterPart = masterTarget && layoutPart ? resolveTarget(layoutPart, masterTarget) : "";
    const masterXml = masterPart ? await zip.file(masterPart)!.async("string") : "";
    const shapes = [
      ...(masterXml
        ? paintPart(masterXml, await imageMap(zip, masterPart), theme, scaleX, scaleY, ptToPx, true)
        : []),
      ...(layoutXml
        ? paintPart(layoutXml, await imageMap(zip, layoutPart), theme, scaleX, scaleY, ptToPx, true)
        : []),
      ...paintPart(xml, await imageMap(zip, part), theme, scaleX, scaleY, ptToPx, false),
    ];
    slides.push({ shapes });
  }
  return slides;
}
