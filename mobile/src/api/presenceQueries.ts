// src/api/presenceQueries.ts
import { post } from "./client";
import type { ApiEnvelope } from "../types/api";

export const heartbeat = (): Promise<ApiEnvelope<{ expiresAt: string }>> =>
  post("/api/presence/heartbeat", {});

export const ackNotice = (): Promise<ApiEnvelope<unknown>> =>
  post("/api/presence/ackNotice", {});
