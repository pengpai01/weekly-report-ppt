import { REPORT_IMAGES_TABLE, TABLE_PREFIX } from "./config.js";

if (!REPORT_IMAGES_TABLE.startsWith(TABLE_PREFIX)) {
  throw new Error(`Refusing to use table ${REPORT_IMAGES_TABLE}; must start with ${TABLE_PREFIX}`);
}

/** Official template mosaic tiles. Cover and closing share these relationship ids. */
export const IMAGE_SLOTS = ["cover-1", "cover-2", "cover-3"];

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Multipart envelope allowance above the image itself. */
export const MAX_IMAGE_BODY_BYTES = MAX_IMAGE_BYTES + 64 * 1024;

export const CREATE_REPORT_IMAGES_SQL = `
CREATE TABLE IF NOT EXISTS \`${REPORT_IMAGES_TABLE}\` (
  \`id\` VARCHAR(64) NOT NULL,
  \`report_id\` VARCHAR(64) NOT NULL,
  \`slot\` VARCHAR(32) NOT NULL,
  \`mime\` VARCHAR(64) NOT NULL,
  \`filename\` VARCHAR(255) NOT NULL DEFAULT '',
  \`byte_length\` INT NOT NULL,
  \`bytes\` LONGBLOB NOT NULL,
  \`created_at\` DATETIME(3) NOT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uniq_wr_report_images_slot\` (\`report_id\`, \`slot\`),
  KEY \`idx_wr_report_images_report\` (\`report_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export function isImageSlot(slot) {
  return IMAGE_SLOTS.includes(slot);
}

export function safeImageFilename(name) {
  const base = String(name || "image").split(/[/\\]/).pop() || "image";
  const cleaned = base.replace(/[^\w.\-\u3400-\u9fff]+/g, "_").slice(0, 180);
  return cleaned || "image";
}

/** Magic-byte sniff. Declared Content-Type is ignored. SVG and other types fail closed. */
export function sniffImage(buffer) {
  if (!buffer || buffer.length < 3) return null;
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function publicImage(row) {
  return {
    id: row.id,
    slot: row.slot,
    mime: row.mime,
    filename: row.filename,
    byteLength: Number(row.byteLength ?? row.byte_length ?? 0),
  };
}

export function createMemoryImageRepository() {
  /** @type {Map<string, Map<string, object>>} */
  const byReport = new Map();

  function slotsOf(reportId) {
    return byReport.get(reportId) ?? null;
  }

  return {
    list(reportId) {
      const slots = slotsOf(reportId);
      if (!slots) return [];
      return [...slots.values()].map(publicImage);
    },
    put(reportId, image, id) {
      let slots = byReport.get(reportId);
      if (!slots) {
        slots = new Map();
        byReport.set(reportId, slots);
      }
      const row = {
        id,
        slot: image.slot,
        mime: image.mime,
        filename: image.filename,
        byteLength: image.bytes.length,
        bytes: Buffer.from(image.bytes),
      };
      slots.set(image.slot, row);
      return publicImage(row);
    },
    read(reportId, imageId) {
      const slots = slotsOf(reportId);
      if (!slots) return null;
      for (const row of slots.values()) {
        if (row.id === imageId) return { ...publicImage(row), bytes: Buffer.from(row.bytes) };
      }
      return null;
    },
    delete(reportId, imageId) {
      const slots = slotsOf(reportId);
      if (!slots) return false;
      for (const [slot, row] of slots) {
        if (row.id === imageId) {
          slots.delete(slot);
          return true;
        }
      }
      return false;
    },
    removeReport(reportId) {
      byReport.delete(reportId);
    },
  };
}

export async function ensureReportImagesTable(pool) {
  await pool.query(CREATE_REPORT_IMAGES_SQL);
}

export function createSqlImageRepository(pool) {
  return {
    async list(reportId) {
      const [rows] = await pool.execute(
        `SELECT \`id\`, \`slot\`, \`mime\`, \`filename\`, \`byte_length\`
         FROM \`${REPORT_IMAGES_TABLE}\` WHERE \`report_id\` = ? ORDER BY \`slot\``,
        [reportId],
      );
      return rows.map(publicImage);
    },
    async put(reportId, image, id) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.execute(
          `DELETE FROM \`${REPORT_IMAGES_TABLE}\` WHERE \`report_id\` = ? AND \`slot\` = ?`,
          [reportId, image.slot],
        );
        await conn.execute(
          `INSERT INTO \`${REPORT_IMAGES_TABLE}\` (
            \`id\`, \`report_id\`, \`slot\`, \`mime\`, \`filename\`, \`byte_length\`, \`bytes\`, \`created_at\`
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            reportId,
            image.slot,
            image.mime,
            image.filename,
            image.bytes.length,
            image.bytes,
            new Date(),
          ],
        );
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
      return publicImage({
        id,
        slot: image.slot,
        mime: image.mime,
        filename: image.filename,
        byteLength: image.bytes.length,
      });
    },
    async read(reportId, imageId) {
      const [rows] = await pool.execute(
        `SELECT \`id\`, \`slot\`, \`mime\`, \`filename\`, \`byte_length\`, \`bytes\`
         FROM \`${REPORT_IMAGES_TABLE}\` WHERE \`report_id\` = ? AND \`id\` = ? LIMIT 1`,
        [reportId, imageId],
      );
      const row = rows[0];
      if (!row) return null;
      const bytes = Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes);
      return { ...publicImage(row), bytes };
    },
    async delete(reportId, imageId) {
      const [result] = await pool.execute(
        `DELETE FROM \`${REPORT_IMAGES_TABLE}\` WHERE \`report_id\` = ? AND \`id\` = ?`,
        [reportId, imageId],
      );
      return result.affectedRows > 0;
    },
    async removeReport(reportId) {
      await pool.execute(`DELETE FROM \`${REPORT_IMAGES_TABLE}\` WHERE \`report_id\` = ?`, [reportId]);
    },
  };
}
