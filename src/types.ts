export type TemplateType = "weekly" | "biweekly";

export type ReportStatus = "draft" | "generated" | "exported";

export type ProjectStatus = "in_progress" | "launched" | "support";

export type SlideType =
  | "cover"
  | "toc"
  | "part"
  | "project"
  | "issues"
  | "plan"
  | "closing";

/** One source line kept so a later manual merge can prefix `[状态·负责人]` and retain sourceId. */
export interface MergeLine {
  text: string;
  statusLabel?: string;
  owner?: string;
  sourceId?: string;
}

export interface Project {
  id: string;
  name: string;
  bullets: string[];
  status?: ProjectStatus;
  /** Display status used only when prefixing body lines. Not the slide badge enum. */
  statusLabel?: string;
  owner?: string;
  sourceId?: string;
  sourceIds?: string[];
  mergeLines?: MergeLine[];
}

export interface IssueItem {
  id: string;
  text: string;
  /** Formal name used by manual merge. Body stays in `text`. */
  title?: string;
  statusLabel?: string;
  owner?: string;
  sourceId?: string;
  sourceIds?: string[];
  mergeLines?: MergeLine[];
}

export interface NextWeekRow {
  id: string;
  projectName: string;
  items: string[];
  statusLabel?: string;
  owner?: string;
  sourceId?: string;
  sourceIds?: string[];
  mergeLines?: MergeLine[];
}

export interface CoverPayload {
  title: string;
  department: string;
  dateLabel: string;
  author: string;
  templateType: TemplateType;
}

export interface TocPayload {
  items: { index: string; title: string; en: string }[];
}

export interface PartPayload {
  partNo: string;
  title: string;
  en: string;
}

export interface ProjectPayload {
  projectId: string;
  name: string;
  ordinal: string;
  bullets: string[];
  bulletOffset: number;
  continued: boolean;
  status?: ProjectStatus;
}

export interface IssuesPayload {
  empty: boolean;
  items: string[];
}

export interface PlanPayload {
  rows: { projectName: string; items: string[] }[];
}

export interface ClosingPayload {
  message: string;
  department: string;
}

export type SlidePayload =
  | CoverPayload
  | TocPayload
  | PartPayload
  | ProjectPayload
  | IssuesPayload
  | PlanPayload
  | ClosingPayload;

export interface Slide {
  id: string;
  type: SlideType;
  payload: SlidePayload;
}

export interface Report {
  id: string;
  templateType: TemplateType;
  title: string;
  department: string;
  date: string;
  author: string;
  projects: Project[];
  issues: { empty: boolean; items: IssueItem[] };
  nextWeek: NextWeekRow[];
  slides: Slide[];
  status: ReportStatus;
  createdAt: string;
  updatedAt: string;
}

export interface YunxiaoWorkItem {
  id: string;
  title: string;
  category: string;
  status: string;
  module?: string;
  assignee?: string;
  updatedAt: string;
  sprint?: string;
}

export interface YunxiaoWorkItemList {
  items: YunxiaoWorkItem[];
}

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  in_progress: "进行中",
  launched: "已上线",
  support: "支持中",
};

export const TEMPLATE_LABEL: Record<TemplateType, string> = {
  weekly: "周工作总结",
  biweekly: "双周工作总结",
};

export const TOC_ITEMS = [
  { index: "01", title: "重要事项汇报", en: "Key Progress" },
  { index: "02", title: "存在问题与建议", en: "Issues & Suggestions" },
  { index: "03", title: "下周工作计划", en: "Next Week Plan" },
] as const;

export const MAX_BULLETS_PER_PAGE = 6;
export const MAX_PLAN_ROWS_PER_PAGE = 8;
