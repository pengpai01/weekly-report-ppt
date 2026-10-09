export type StoredReport = {
  id: string;
  templateType: "weekly" | "biweekly";
  title: string;
  department: string;
  date: string;
  author: string;
  projects: unknown[];
  issues: unknown;
  nextWeek: unknown[];
  slides: unknown[];
  status: string;
  createdAt: string;
  updatedAt: string;
};

export const REPORTS_TABLE: "wr_reports";
export const TABLE_PREFIX: "wr_";

export function defaultDataDir(): string;
export function createId(): string;
export function normalizeReport(
  input?: Partial<StoredReport> & Record<string, unknown>,
  existing?: StoredReport,
): StoredReport;

export type StoredImage = {
  id: string;
  slot: string;
  mime: string;
  filename: string;
  byteLength: number;
};

export type ReportStore = {
  dataDir: string;
  list(): Promise<StoredReport[]>;
  get(id: string): Promise<StoredReport | null>;
  create(input?: Partial<StoredReport> & Record<string, unknown>): Promise<StoredReport>;
  update(
    id: string,
    input?: Partial<StoredReport> & Record<string, unknown>,
  ): Promise<StoredReport>;
  delete(id: string): Promise<void>;
  listImages(reportId: string): Promise<StoredImage[]>;
  putImage(
    reportId: string,
    image: { slot: string; mime: string; filename: string; bytes: Buffer },
  ): Promise<StoredImage>;
  readImage(
    reportId: string,
    imageId: string,
  ): Promise<(StoredImage & { bytes: Buffer }) | null>;
  deleteImage(reportId: string, imageId: string): Promise<boolean>;
  close(): Promise<void>;
};

export function createReportStore(options?: {
  pool?: unknown;
  dataDir?: string;
}): ReportStore;

export function createMemoryReportStore(): ReportStore;
export function ensureOwnTables(pool: unknown): Promise<void>;
