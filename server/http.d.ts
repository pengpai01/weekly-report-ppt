import type { IncomingMessage, ServerResponse } from "node:http";
import type { ReportStore } from "./store.js";

export function routeApi(
  store: ReportStore,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean>;

export function createConnectApi(
  store: ReportStore,
): (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;
