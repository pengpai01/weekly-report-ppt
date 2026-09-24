/**
 * Shared template-fill path for preview and export.
 * Both call fillOfficialTemplate(), which opens templates/week-summary-template.pptx,
 * writes the report into that file, and returns the same bytes the download uses.
 * The filler unzips the template with JSZip
 * and replaces text in the official shapes. Preview draws those filled shapes;
 * it does not keep a second slide layout. 1ppt.com ad text is removed.
 */
import JSZip from "jszip";
import templateUrl from "../../templates/week-summary-template.pptx?url";
import { parseFilledSlides, type FilledSlide } from "./templateSlides";
import type {
  ClosingPayload,
  CoverPayload,
  IssuesPayload,
  PartPayload,
  PlanPayload,
  ProjectPayload,
  Report,
  Slide,
  TocPayload,
} from "../types";
import { PROJECT_STATUS_LABEL } from "../types";
import { compactDate } from "./format";
import { generateSlides } from "./generateSlides";

const OFFICIAL_TEMPLATE_PATH = "templates/week-summary-template.pptx";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const SLIDE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";

const CONTENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout3.xml"/></Relationships>`;

type Line = { text: string; level: number };
type Box = { idx: string; x: string; y: string; cx: string; cy: string };
type Placed = { file: string; xml: string; kind: "cover" | "content" | "closing" };

function as<T>(payload: Slide["payload"]): T {
  return payload as T;
}

function esc(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function shapePlainText(shape: string): string {
  return [...shape.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map((match) => match[1]).join("");
}

function shapeIdContaining(xml: string, text: string): string {
  const shapes = xml.match(/<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/g) ?? [];
  for (const shape of shapes) {
    if (!shapePlainText(shape).includes(text)) continue;
    const id = /<p:cNvPr\b[^>]*\bid="(\d+)"/.exec(shape);
    if (id) return id[1];
  }
  throw new Error(`模板中未找到占位文本「${text}」`);
}

function replaceShapeParagraphs(xml: string, shapeId: string, paragraphs: string): string {
  const marker = `<p:cNvPr id="${shapeId}"`;
  const start = xml.indexOf(marker);
  if (start < 0) throw new Error(`模板形状 ${shapeId} 不存在`);
  const spStart = xml.lastIndexOf("<p:sp>", start);
  const spEnd = xml.indexOf("</p:sp>", start);
  if (spStart < 0 || spEnd < 0) throw new Error(`模板形状 ${shapeId} 结构无法识别`);
  const shape = xml.slice(spStart, spEnd);
  const txStart = shape.indexOf("<p:txBody>");
  const txEnd = shape.indexOf("</p:txBody>");
  if (txStart < 0 || txEnd < 0) throw new Error(`模板形状 ${shapeId} 没有文本框`);
  const tx = shape.slice(txStart, txEnd);
  const closed = tx.indexOf("</a:lstStyle>");
  const self = tx.indexOf("<a:lstStyle/>");
  const headEnd =
    closed >= 0
      ? closed + "</a:lstStyle>".length
      : self >= 0
        ? self + "<a:lstStyle/>".length
        : -1;
  if (headEnd < 0) throw new Error(`模板形状 ${shapeId} 缺少 lstStyle`);
  const newShape = shape.slice(0, txStart) + tx.slice(0, headEnd) + paragraphs + shape.slice(txEnd);
  return xml.slice(0, spStart) + newShape + xml.slice(spEnd);
}

function setShapeCy(xml: string, shapeId: string, cy: string): string {
  const marker = `<p:cNvPr id="${shapeId}"`;
  const start = xml.indexOf(marker);
  const spStart = xml.lastIndexOf("<p:sp>", start);
  const spEnd = xml.indexOf("</p:sp>", start);
  const shape = xml.slice(spStart, spEnd);
  const updated = shape.replace(/<a:ext cx="(\d+)" cy="\d+"\/>/, `<a:ext cx="$1" cy="${cy}"/>`);
  return xml.slice(0, spStart) + updated + xml.slice(spEnd);
}

function coverTitleParagraph(text: string): string {
  return `<a:p><a:pPr><a:buNone/></a:pPr><a:r><a:rPr lang="zh-CN" altLang="en-US" sz="4000" dirty="0"><a:sym typeface="+mn-ea"/></a:rPr><a:t>${esc(text)}</a:t></a:r><a:endParaRPr lang="zh-CN" altLang="en-US" sz="4000" b="1" dirty="0"><a:solidFill><a:schemeClr val="bg1"><a:lumMod val="65000"/></a:schemeClr></a:solidFill><a:cs typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/></a:endParaRPr></a:p>`;
}

function coverMetaParagraph(text: string): string {
  return `<a:p><a:pPr><a:buNone/></a:pPr><a:r><a:rPr lang="zh-CN" altLang="en-US" sz="2000" dirty="0"><a:cs typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p>`;
}

function contentTitleParagraph(text: string): string {
  return `<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-CN" altLang="en-US" sz="2400" dirty="0"><a:latin typeface="微软雅黑" panose="020B0503020204020204" pitchFamily="34" charset="-122"/><a:ea typeface="微软雅黑" panose="020B0503020204020204" pitchFamily="34" charset="-122"/></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p>`;
}

function bodyParagraphs(lines: Line[]): string {
  if (lines.length === 0) {
    return `<a:p><a:endParaRPr lang="zh-CN" altLang="en-US"/></a:p>`;
  }
  return lines
    .map((line) => {
      const level = Math.max(0, Math.min(4, line.level));
      return `<a:p><a:pPr lvl="${level}"/><a:r><a:rPr lang="zh-CN" altLang="en-US" dirty="0"/><a:t>${esc(line.text)}</a:t></a:r></a:p>`;
    })
    .join("");
}

function bodyShape(id: number, box: Box, lines: Line[]): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="内容占位符 ${id}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph sz="half" idx="${box.idx}"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.cx}" cy="${box.cy}"/></a:xfrm></p:spPr><p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/>${bodyParagraphs(lines)}</p:txBody></p:sp>`;
}

function placeholderBox(layoutXml: string, idx: string): Box {
  const re = new RegExp(
    `idx="${idx}"[\\s\\S]{0,2500}?<a:off x="(\\d+)" y="(\\d+)"/><a:ext cx="(\\d+)" cy="(\\d+)"/>`,
  );
  const match = re.exec(layoutXml);
  if (!match) throw new Error(`模板正文占位 idx=${idx} 未找到`);
  return { idx, x: match[1], y: match[2], cx: match[3], cy: match[4] };
}

function splitColumns(lines: Line[]): [Line[], Line[]] {
  if (lines.length === 0) return [[], []];
  const groups: Line[][] = [];
  for (const line of lines) {
    if (line.level === 0 || groups.length === 0) groups.push([line]);
    else groups[groups.length - 1].push(line);
  }
  if (groups.length < 2) return [lines, []];
  const mid = Math.ceil(groups.length / 2);
  return [groups.slice(0, mid).flat(), groups.slice(mid).flat()];
}

function fillCover(proto: string, payload: CoverPayload): string {
  const titleId = shapeIdContaining(proto, "AI项目总结汇报");
  const metaId = shapeIdContaining(proto, "部   门：");
  const lines = [
    `部   门：${payload.department.trim() || "—"}`,
    `日   期：${payload.dateLabel.trim() || "—"}`,
  ];
  if (payload.author.trim()) lines.push(`汇 报 人：${payload.author.trim()}`);
  let xml = replaceShapeParagraphs(proto, titleId, coverTitleParagraph(payload.title || "周工作总结"));
  xml = replaceShapeParagraphs(xml, metaId, lines.map(coverMetaParagraph).join(""));
  if (lines.length > 2) xml = setShapeCy(xml, metaId, "820000");
  return xml;
}

function fillContent(
  proto: string,
  titleId: string,
  title: string,
  lines: Line[],
  left: Box,
  right: Box,
): string {
  let xml = replaceShapeParagraphs(proto, titleId, contentTitleParagraph(title));
  const [lead, rest] = splitColumns(lines);
  const shapes = bodyShape(4, left, lead) + bodyShape(5, right, rest);
  const at = xml.lastIndexOf("</p:spTree>");
  if (at < 0) throw new Error("模板项目页结构无法识别");
  return xml.slice(0, at) + shapes + xml.slice(at);
}

function fillClosing(proto: string, payload: ClosingPayload): string {
  const token = "<a:t>感谢您的聆听！</a:t>";
  if (!proto.includes(token)) throw new Error("模板结束页未找到「感谢您的聆听！」");
  const message = payload.message.trim() || "感谢聆听";
  return proto.replaceAll(token, `<a:t>${esc(message)}</a:t>`);
}

function linesFor(slide: Slide): { title: string; lines: Line[] } {
  switch (slide.type) {
    case "toc": {
      const payload = as<TocPayload>(slide.payload);
      return {
        title: "目录",
        lines: payload.items.flatMap((item) => [
          { text: `${item.index}  ${item.title}`, level: 0 },
          { text: item.en, level: 1 },
        ]),
      };
    }
    case "part": {
      const payload = as<PartPayload>(slide.payload);
      return {
        title: `${payload.partNo}  ${payload.title}`,
        lines: payload.en ? [{ text: payload.en, level: 0 }] : [],
      };
    }
    case "project": {
      const payload = as<ProjectPayload>(slide.payload);
      const status = payload.status ? `（${PROJECT_STATUS_LABEL[payload.status]}）` : "";
      const continued = payload.continued ? "（续）" : "";
      return {
        title: `${payload.ordinal}、${payload.name}${status}${continued}`,
        lines: payload.bullets.map((text) => ({ text, level: 0 })),
      };
    }
    case "issues": {
      const payload = as<IssuesPayload>(slide.payload);
      return {
        title: "存在问题与建议",
        lines:
          payload.empty || payload.items.length === 0
            ? [
                { text: "N/A", level: 0 },
                { text: "本期无问题与建议", level: 1 },
              ]
            : payload.items.map((text) => ({ text, level: 0 })),
      };
    }
    case "plan": {
      const payload = as<PlanPayload>(slide.payload);
      return {
        title: "下周工作计划",
        lines: payload.rows.flatMap((row) => [
          { text: row.projectName || "—", level: 0 },
          ...(row.items.length
            ? row.items.map((text) => ({ text, level: 1 }))
            : [{ text: "—", level: 1 }]),
        ]),
      };
    }
    default:
      return { title: "周工作总结", lines: [] };
  }
}

function removeAdShapes(xml: string): string {
  return xml.replace(/<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/g, (shape) => {
    const text = [...shape.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]).join("");
    if (/1ppt|第一PPT|PPT模板下载|PPT论坛/i.test(text)) return "";
    return shape;
  });
}

function stripBrand(xml: string): string {
  return xml
    .replaceAll("第一PPT，www.1ppt.com", "周工作总结")
    .replaceAll("第一PPT模板网-WWW.1PPT.COM", "")
    .replaceAll("第一PPT", "")
    .replace(/www\.1ppt\.(com|cn)/gi, "")
    .replace(/1ppt\.(com|cn)/gi, "");
}

async function scrubZip(zip: JSZip): Promise<void> {
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir && /\.(xml|rels)$/i.test(name));
  for (const name of names) {
    const text = await zip.file(name)!.async("string");
    const cleaned = stripBrand(removeAdShapes(text));
    if (cleaned !== text) zip.file(name, cleaned);
  }
}

async function readXml(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`官方模板缺少 ${path}`);
  return file.async("string");
}

function replaceTag(xml: string, tag: string, value: string): string {
  const re = new RegExp(`(<${tag}\\b[^>]*>)[\\s\\S]*?(</${tag}>)`);
  if (!re.test(xml)) return xml;
  return xml.replace(re, `$1${esc(value)}$2`);
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

export function exportFileName(report: Report): string {
  const dept = report.department.trim() || "部门";
  return `${dept}-${report.title}-${compactDate(report.date)}.pptx`;
}

let templateBytesPromise: Promise<ArrayBuffer> | null = null;

function loadOfficialTemplate(): Promise<ArrayBuffer> {
  templateBytesPromise ??= fetch(templateUrl).then((response) => {
    if (!response.ok) throw new Error(`无法读取官方模板 ${OFFICIAL_TEMPLATE_PATH}`);
    return response.arrayBuffer();
  });
  return templateBytesPromise;
}

/** Preview and download both use this. `slides` is parsed from the bytes that get saved. */
export async function fillOfficialTemplate(
  report: Report,
  template?: ArrayBuffer | Uint8Array,
): Promise<{ bytes: Uint8Array; slides: FilledSlide[] }> {
  const bytes = await buildPptxBytes(report, template ?? (await loadOfficialTemplate()));
  const slides = await parseFilledSlides(bytes);
  return { bytes, slides };
}

export async function buildPptxBytes(
  report: Report,
  template: ArrayBuffer | Uint8Array,
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(template);
  await scrubZip(zip);

  const coverProto = await readXml(zip, "ppt/slides/slide1.xml");
  const contentProto = await readXml(zip, "ppt/slides/slide2.xml");
  const closingFile = zip.file("ppt/slides/slide3.xml");
  const closingProto = closingFile ? await closingFile.async("string") : "";
  const layoutXml = await readXml(zip, "ppt/slideLayouts/slideLayout3.xml");
  const left = placeholderBox(layoutXml, "1");
  const right = placeholderBox(layoutXml, "13");
  const contentTitleId = shapeIdContaining(contentProto, "微生物形态学鉴定");
  const coverRels = zip.file("ppt/slides/_rels/slide1.xml.rels");
  const coverRelsXml = coverRels ? await coverRels.async("string") : CONTENT_RELS;

  const slides = report.slides.length > 0 ? report.slides : generateSlides(report);
  const placed: Placed[] = [];
  let contentUsed = false;
  let coverUsed = false;
  let closingUsed = false;
  let nextNum = 4;

  const alloc = (kind: Placed["kind"]): string => {
    if (kind === "cover" && !coverUsed) {
      coverUsed = true;
      return "slide1.xml";
    }
    if (kind === "content" && !contentUsed) {
      contentUsed = true;
      return "slide2.xml";
    }
    if (kind === "closing" && closingProto && !closingUsed) {
      closingUsed = true;
      return "slide3.xml";
    }
    return `slide${nextNum++}.xml`;
  };

  for (const slide of slides) {
    if (slide.type === "cover") {
      placed.push({
        file: alloc("cover"),
        xml: fillCover(coverProto, as<CoverPayload>(slide.payload)),
        kind: "cover",
      });
      continue;
    }
    if (slide.type === "closing" && closingProto) {
      placed.push({
        file: alloc("closing"),
        xml: fillClosing(closingProto, as<ClosingPayload>(slide.payload)),
        kind: "closing",
      });
      continue;
    }
    const { title, lines } = slide.type === "closing"
      ? { title: as<ClosingPayload>(slide.payload).message || "感谢聆听", lines: [] }
      : linesFor(slide);
    placed.push({
      file: alloc("content"),
      xml: fillContent(contentProto, contentTitleId, title, lines, left, right),
      kind: "content",
    });
  }

  const kept = new Set(placed.map((item) => item.file));
  for (const name of ["slide1.xml", "slide2.xml", "slide3.xml"]) {
    if (kept.has(name)) continue;
    zip.remove(`ppt/slides/${name}`);
    zip.remove(`ppt/slides/_rels/${name}.rels`);
  }

  for (const item of placed) {
    zip.file(`ppt/slides/${item.file}`, item.xml);
    if (item.file === "slide1.xml" || item.file === "slide2.xml" || item.file === "slide3.xml") continue;
    const rels = item.kind === "cover" ? coverRelsXml : CONTENT_RELS;
    zip.file(`ppt/slides/_rels/${item.file}.rels`, rels);
  }

  let relsXml = await readXml(zip, "ppt/_rels/presentation.xml.rels");
  let contentTypes = await readXml(zip, "[Content_Types].xml");
  for (const name of ["slide1.xml", "slide2.xml", "slide3.xml"]) {
    if (kept.has(name)) continue;
    contentTypes = contentTypes.replace(
      new RegExp(`<Override PartName="/ppt/slides/${name}"[^>]*/>`),
      "",
    );
  }

  const rels = parseRels(relsXml);
  const slideRelByFile = new Map<string, string>();
  for (const rel of rels) {
    if (!rel.type.endsWith("/slide")) continue;
    const file = rel.target.split("/").pop();
    if (file) slideRelByFile.set(file, rel.id);
  }
  let nextRid = Math.max(0, ...rels.map((rel) => Number(/^rId(\d+)$/.exec(rel.id)?.[1] ?? 0))) + 1;
  const usedRelIds: string[] = [];
  for (const item of placed) {
    let id = slideRelByFile.get(item.file);
    if (!id) {
      id = `rId${nextRid++}`;
      slideRelByFile.set(item.file, id);
      relsXml = relsXml.replace(
        "</Relationships>",
        `<Relationship Id="${id}" Type="${SLIDE_REL}" Target="slides/${item.file}"/></Relationships>`,
      );
      if (!contentTypes.includes(`PartName="/ppt/slides/${item.file}"`)) {
        contentTypes = contentTypes.replace(
          "</Types>",
          `<Override PartName="/ppt/slides/${item.file}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`,
        );
      }
    }
    usedRelIds.push(id);
  }
  const used = new Set(usedRelIds);
  relsXml = relsXml.replace(/<Relationship\b[^>]*\/>/g, (tag) => {
    const type = /Type="([^"]+)"/.exec(tag)?.[1] ?? "";
    const id = /Id="([^"]+)"/.exec(tag)?.[1] ?? "";
    if (type.endsWith("/slide") && !used.has(id)) return "";
    return tag;
  });

  const sldIdLst = usedRelIds
    .map((id, index) => `<p:sldId id="${256 + index}" r:id="${id}"/>`)
    .join("");
  let presentation = await readXml(zip, "ppt/presentation.xml");
  presentation = presentation.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${sldIdLst}</p:sldIdLst>`);

  let core = await readXml(zip, "docProps/core.xml");
  core = replaceTag(core, "dc:title", report.title || "周工作总结");
  core = replaceTag(core, "dc:creator", report.author.trim() || report.department.trim() || "汇报助手");
  core = replaceTag(core, "cp:keywords", "");

  const appFile = zip.file("docProps/app.xml");
  if (appFile) {
    let app = await appFile.async("string");
    app = app.replace(/<Slides>\d+<\/Slides>/, `<Slides>${placed.length}</Slides>`);
    zip.file("docProps/app.xml", app);
  }

  zip.file("ppt/_rels/presentation.xml.rels", relsXml);
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("ppt/presentation.xml", presentation);
  zip.file("docProps/core.xml", core);

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function downloadPptx(report: Report): Promise<string> {
  const { bytes } = await fillOfficialTemplate(report);
  const fileName = exportFileName(report);
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const blob = new Blob([copy], { type: PPTX_MIME });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return fileName;
}
