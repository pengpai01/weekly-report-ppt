export const YUNZHIJIA_NOTE = [
  "主路径：复制要点粘贴拆分，或整理成模板后上传",
  "可选：群内多选近两周相关消息 → 智能生成摘要 → 粘贴拆分，或稍作整理后进模板上传",
  "说明：官方暂无历史消息 API；不承诺摘要自动解析；不做自动化抓取；机器人本期不排期",
] as const;

export const INGEST_TEMPLATE_CSV = "/templates/weekly-report-ingest.csv";
export const INGEST_TEMPLATE_XLSX = "/templates/weekly-report-ingest.xlsx";
export const INGEST_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const INGEST_ACCEPT = ".xlsx,.csv";

export const INGEST_TEMPLATE_HEADERS = [
  "事项标题",
  "状态",
  "模块",
  "负责人",
  "详情",
  "计划日期",
  "来源ID",
] as const;

export const INGEST_TEMPLATE_ROWS = [
  ["联调设备协议", "进行中", "设备管理", "张三", "与硬件联调", "2026-09-20", "dev-1"],
  ["登录失败", "Bug", "设备管理", "", "", "", "bug-1"],
  ["下周压测", "待处理", "设备管理", "", "", "", "plan-1"],
] as const;
