import type { Project } from "../types";
import { createId } from "./format";

const HEADER =
  /^[ \t]*(?:(?:第)?[一二三四五六七八九十百零\d]+[、.．.)）]|【([^】]+)】|(?:\d{1,2})[、.．]\s*)(.+)?$/;

function looksLikeHeader(line: string): { name: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const cn = trimmed.match(
    /^[一二三四五六七八九十]+[、.．]\s*(.+)$/,
  );
  if (cn) return { name: cleanName(cn[1]) };

  const numbered = trimmed.match(/^(?:第)?\d{1,2}[、.．.)）]\s*(.+)$/);
  if (numbered) return { name: cleanName(numbered[1]) };

  const bracket = trimmed.match(/^【(.+?)】$/);
  if (bracket) return { name: cleanName(bracket[1]) };

  return null;
}

function cleanName(name: string): string {
  return name.replace(/[：:]\s*$/, "").trim();
}

function splitBulletLine(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  const circled = trimmed.split(/(?=[①②③④⑤⑥⑦⑧⑨⑩⑪⑫])/u);
  if (circled.length > 1) {
    return circled
      .map((part) =>
        part
          .replace(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]\s*/, "")
          .replace(/[;；。]\s*$/, "")
          .trim(),
      )
      .filter(Boolean);
  }

  const dashed = trimmed.replace(/^[-*•·–—]\s+/, "");
  const numbered = dashed.replace(/^\d{1,2}[、.．)）]\s*/, "");
  return numbered ? [numbered] : [];
}

/**
 * Rule-based splitter: project headers (一、项目 / 1. 项目 / 【项目】)
 * plus circled or dashed bullets. Callers must confirm before applying.
 */
export function splitProjectsFromText(text: string): Project[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const projects: { name: string; bullets: string[]; lead: string[] }[] = [];
  let current: { name: string; bullets: string[]; lead: string[] } | null = null;

  const flushLead = () => {
    if (!current) return;
    if (current.lead.length && current.bullets.length === 0) {
      current.bullets.push(current.lead.join(" ").trim());
    } else if (current.lead.length) {
      current.bullets.unshift(current.lead.join(" ").trim());
    }
    current.lead = [];
  };

  for (const raw of lines) {
    const header = looksLikeHeader(raw);
    if (header) {
      if (current) flushLead();
      current = { name: header.name, bullets: [], lead: [] };
      projects.push(current);
      continue;
    }
    if (!current) {
      if (raw.trim()) {
        current = { name: raw.trim().slice(0, 40), bullets: [], lead: [] };
        projects.push(current);
      }
      continue;
    }

    const bullets = splitBulletLine(raw);
    if (bullets.length) {
      current.bullets.push(...bullets);
    } else if (raw.trim()) {
      current.lead.push(raw.trim().replace(/[：:]\s*$/, ""));
    } else {
      flushLead();
    }
  }
  if (current) flushLead();

  return projects
    .filter((p) => p.name)
    .map((p) => ({
      id: createId(),
      name: p.name,
      bullets: p.bullets.filter(Boolean),
    }));
}

export { HEADER };
