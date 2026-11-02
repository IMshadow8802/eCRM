// Typed response fixtures. A mocked fetcher's resolved value goes through
// these instead of `as never`, so a fixture that drifts from the fetcher's
// real return type fails `pnpm typecheck`.
import type { ApiEnvelope, Pagination } from "../types/api";

export function envelope<T>(data: T, extra: Partial<ApiEnvelope<T>> = {}): ApiEnvelope<T> {
  return {
    success: true,
    message: "OK",
    responseCode: 200,
    data,
    timestamp: "2026-11-02T00:00:00.000Z",
    ...extra,
  };
}

export const pagination = (totalRecords: number, extra: Partial<Pagination> = {}): Pagination => ({
  currentPage: 1,
  pageSize: 50,
  totalRecords,
  totalPages: Math.max(1, Math.ceil(totalRecords / 50)),
  ...extra,
});
