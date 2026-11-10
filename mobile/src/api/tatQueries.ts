// src/api/tatQueries.ts
// Task TAT clocks. Bodies mirror web/src/api/tatQueries.js callers and
// backend/src/controllers/tatController.js. Mobile acts on the caller's own
// clock plus verdicts where the server says CanJudge; no hold/release for everyone.
import { post } from "./client";
import type { TaskTat } from "../types/api";

const TAT_ENDPOINTS = {
  fetchTaskTat: "/api/tat/fetchTaskTat",
  acknowledge: "/api/tat/acknowledge",
  hold: "/api/tat/hold",
  release: "/api/tat/release",
  myPartDone: "/api/tat/myPartDone",
  saveReason: "/api/tat/saveReason",
  saveVerdict: "/api/tat/saveVerdict",
} as const;

export const fetchTaskTat = (TaskId: number): Promise<TaskTat> =>
  post<TaskTat>(TAT_ENDPOINTS.fetchTaskTat, { TaskId }).then(
    (b) => b.data ?? { clocks: [], holds: [], events: [] },
  );

export const acknowledgeTat = (TaskId: number) => post(TAT_ENDPOINTS.acknowledge, { TaskId });
export const myPartDone = (TaskId: number) => post(TAT_ENDPOINTS.myPartDone, { TaskId });
export const releaseMine = (TaskId: number) =>
  post(TAT_ENDPOINTS.release, { TaskId, Mine: true });
export const holdMine = (p: { TaskId: number; ReasonId: number; Remarks: string | null }) =>
  post(TAT_ENDPOINTS.hold, { ...p, Mine: true });
export const saveTatReason = (p: {
  TaskId: number;
  TatId: number;
  ReasonId: number;
  Remarks: string | null;
}) => post(TAT_ENDPOINTS.saveReason, p);
/** A judge's ruling on someone else's missed deadline; the server checks who may judge. */
export const saveVerdict = (p: {
  TaskId: number;
  TatId: number;
  Verdict: "excused" | "not_excused";
  Remarks: string | null;
}) => post(TAT_ENDPOINTS.saveVerdict, p);
