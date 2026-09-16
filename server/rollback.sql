-- Rollback for weekly-report-ppt only.
-- Run against the grok_bot database. Do not DROP DATABASE or other tables.
DROP TABLE IF EXISTS wr_reports;
