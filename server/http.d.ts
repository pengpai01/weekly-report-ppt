import type { IncomingMessage, ServerResponse } from "node:http";
import type { ReportStore } from "./store.js";

export type ApiRouteDeps = {
  yunxiaoEnv?: NodeJS.Dict<string>;
  yunxiaoFetch?: typeof fetch;
  yunxiaoClient?: unknown;
  yunxiaoItems?: unknown;
  ingestStore?: unknown;
  previewStore?: unknown;
};

export function routeApi(
  store: ReportStore,
  req: IncomingMessage,
  res: ServerResponse,
  deps?: ApiRouteDeps,
): Promise<boolean>;

export function createConnectApi(
  store: ReportStore,
  deps?: ApiRouteDeps,
): (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;
