-- weekly-report-ppt owned tables only (prefix wr_).
-- Apply to the grok_bot database. Do not create other databases or shared objects.
-- The Node process also runs this on startup via CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS wr_reports (
  `id` VARCHAR(64) NOT NULL,
  `title` VARCHAR(255) NOT NULL DEFAULT '',
  `template_type` VARCHAR(32) NOT NULL DEFAULT 'weekly',
  `department` VARCHAR(255) NOT NULL DEFAULT '',
  `report_date` VARCHAR(32) NOT NULL DEFAULT '',
  `author` VARCHAR(255) NOT NULL DEFAULT '',
  `projects` JSON NOT NULL,
  `issues` JSON NOT NULL,
  `next_week` JSON NOT NULL,
  `slides` JSON NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wr_reports_updated_at` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wr_yunxiao_items (
  `id` VARCHAR(64) NOT NULL,
  `title` VARCHAR(512) NULL,
  `category` VARCHAR(32) NULL,
  `status` VARCHAR(64) NULL,
  `module` VARCHAR(255) NULL,
  `assignee` VARCHAR(255) NULL,
  `sprint` VARCHAR(255) NULL,
  `updated_at` DATETIME(3) NULL,
  `raw_json` JSON NULL,
  `synced_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wr_ingest_raw (
  `id` VARCHAR(64) NOT NULL,
  `preview_id` VARCHAR(64) NOT NULL,
  `source` VARCHAR(32) NOT NULL DEFAULT 'upload',
  `row_no` INT NOT NULL,
  `payload` JSON NOT NULL,
  `ok` TINYINT(1) NOT NULL,
  `error` VARCHAR(512) NULL,
  `source_id` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wr_ingest_raw_preview_id` (`preview_id`),
  KEY `idx_wr_ingest_raw_source_source_id` (`source`, `source_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wr_report_images (
  `id` VARCHAR(64) NOT NULL,
  `report_id` VARCHAR(64) NOT NULL,
  `slot` VARCHAR(32) NOT NULL,
  `mime` VARCHAR(64) NOT NULL,
  `filename` VARCHAR(255) NOT NULL DEFAULT '',
  `byte_length` INT NOT NULL,
  `bytes` LONGBLOB NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_wr_report_images_slot` (`report_id`, `slot`),
  KEY `idx_wr_report_images_report` (`report_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
