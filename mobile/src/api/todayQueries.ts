// src/api/todayQueries.ts
// Today (backend/src/routes/todayRoutes.js, controllers/todayController.js).
// Every flag on a task is computed once, in backend/src/utils/dayBuckets.js —
// mobile reads them, never re-derives them.
import { post } from "./client";
import type { ApiEnvelope, MyDay } from "../types/api";

export const TODAY_ENDPOINTS = { mine: "/api/today/mine" } as const;

/** The caller's own day. No WorkDate = today, the only day with live flags. */
export const fetchMyDay = (): Promise<ApiEnvelope<MyDay>> => post<MyDay>(TODAY_ENDPOINTS.mine, {});
