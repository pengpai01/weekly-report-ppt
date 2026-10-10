import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|js|css)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe("cover image client", () => {
  it("has no cover-slot upload UI and does not call the image API", () => {
    const files = walk(SRC_DIR);
    const blob = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(blob).not.toContain("封面配图");
    expect(blob).not.toContain("CoverImageSlots");
    expect(blob).not.toContain("fetchSlotImages");
    expect(blob).not.toContain("uploadReportImage");
    expect(blob).not.toContain("deleteReportImage");
    expect(blob).not.toContain("/images?");
    expect(blob).not.toMatch(/\/images\/\$\{/);
    expect(blob).not.toContain("REPORT_API_TOKEN");
    expect(blob).not.toContain("x-report-token");
    expect(blob).not.toContain("projects[].media");
  });
});
