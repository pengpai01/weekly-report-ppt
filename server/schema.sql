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
