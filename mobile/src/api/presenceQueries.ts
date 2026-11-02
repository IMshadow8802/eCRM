// src/api/presenceQueries.ts
import { post } from "./client";
import type { ApiEnvelope } from "../types/api";

/** `expiresAt` is null when the session could not be extended (it is ending). */
export const heartbeat = (): Promise<ApiEnvelope<{ expiresAt: string | null }>> =>
  post("/api/presence/heartbeat", {});

export const ackNotice = (): Promise<ApiEnvelope<unknown>> =>
  post("/api/presence/ackNotice", {});
