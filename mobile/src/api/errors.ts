// src/api/errors.ts
//
// Pulling the server's own explanation out of a rejected request.
//
// apiClient leaves axios's default validateStatus alone, so every non-2xx
// REJECTS rather than resolving. The API answers a refused write with 400/403/
// 404 and the standard envelope — { success: false, message: "At least one
// checklist item is required" } — which means that message arrives in
// `onError`, not in `onSuccess`.
//
// The forms were written the other way round: `onSuccess` reads
// `response.message`, while `onError` sets a hardcoded "Check your connection."
// Since a validation failure never reaches onSuccess, someone denied by
// permissions or tripped by a required field was told their network was down.
//
// The fallback still matters and is not merely defensive: a real transport
// failure (timeout, no route to host) has no response at all, and axios's own
// `error.message` for that case is the untranslatable "Network Error".
import { isAxiosError } from "axios";

/**
 * @param error    whatever a mutation rejected with
 * @param fallback shown when the request never reached the server
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    const message = error.response?.data?.message;
    if (typeof message === "string" && message.trim()) return message;
    // A response with no usable message is still a server answer, not a
    // connection problem — but there is nothing better to show than the
    // caller's sentence.
    return fallback;
  }
  // A fetcher that threw on its own (a bad payload, a parse failure) carries a
  // real message; anything else falls back.
  if (error instanceof Error && error.message && !/^Network Error$/i.test(error.message)) {
    return error.message;
  }
  return fallback;
}
