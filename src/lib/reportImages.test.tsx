import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CoverImageSlots } from "../components/CoverImageSlots";
import { IMAGE_SLOTS } from "../../server/images.js";
import { clientImageError, COVER_IMAGE_SLOTS } from "./reportImages";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|js|css)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe("cover image slots", () => {
  it("matches the server slot ids and rejects bad files before upload", () => {
    expect(COVER_IMAGE_SLOTS.map((slot) => slot.id)).toEqual(IMAGE_SLOTS);
    expect(clientImageError({ name: "shot.png", type: "image/png", size: 32 })).toBeNull();
    expect(clientImageError({ name: "shot.jpg", type: "", size: 32 })).toBeNull();
    expect(clientImageError({ name: "diagram.svg", type: "image/svg+xml", size: 32 })).toContain("草稿未改动");
    expect(clientImageError({ name: "notes.txt", type: "text/plain", size: 32 })).toContain("不支持");
    expect(clientImageError({ name: "big.png", type: "image/png", size: 4 * 1024 * 1024 + 1 })).toContain("4MB");
    expect(clientImageError({ name: "empty.png", type: "image/png", size: 0 })).toContain("空的");
  });

  it("renders the three template tiles and does not call onImages while painting", () => {
    const html = renderToStaticMarkup(
      <CoverImageSlots
        reportId="rep 1"
        images={[
          { id: "img 1", slot: "cover-1", mime: "image/png", filename: "a.png", byteLength: 8 },
        ]}
        onImages={() => {
          throw new Error("render must not write the draft");
        }}
      />,
    );
    expect(html).toContain("封面左上");
    expect(html).toContain("封面中部");
    expect(html).toContain("封面右上");
    expect(html).toContain("/api/reports/rep%201/images/img%201");
    expect(html).toContain("移除");
    expect(html).toContain("使用模板原图");
  });

  it("keeps the upload token out of the frontend sources", () => {
    const files = walk(SRC_DIR);
    const blob = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(blob).not.toContain("REPORT_API_TOKEN");
    expect(blob).not.toContain("x-report-token");
  });
});
