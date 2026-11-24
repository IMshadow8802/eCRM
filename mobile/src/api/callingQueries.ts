// src/api/callingQueries.ts
// Calling lists (149), the caller's side. Payloads from
// backend/src/controllers/callingCallerController.js.
//
// The phone can only ask for "my list": no fetcher takes a list id, a contact to
// read or a search term, and no manager endpoint lives here. Every write answers
// with the fresh list, so the screen swaps it in and never fetches twice.
// Times go as local "YYYY-MM-DDTHH:mm" (the server reads IST wall clock).
import { post } from "./client";
import type { ApiEnvelope, CallResult, MyCallList } from "../types/api";

const CALLING_ENDPOINTS = {
  myList: "/api/calling/myList",
  saveResult: "/api/calling/saveResult",
  convert: "/api/calling/convert",
  undoResult: "/api/calling/undoResult",
} as const;

/** Runs the top-up on the server, then returns what the caller holds. */
export const fetchMyCallList = (): Promise<ApiEnvelope<MyCallList>> => post<MyCallList>(CALLING_ENDPOINTS.myList, {});

export interface SaveCallResultParams {
  ContactId: number;
  Result: CallResult;
  Notes?: string | null;
  /** null = saved without dialling (a desk phone). */
  DialedAt?: string | null;
  /** Only with "callback"; null = "no time" (back to the pool tomorrow). */
  CallbackAt?: string | null;
}

export const saveCallResult = ({ ContactId, Result, Notes = null, DialedAt = null, CallbackAt = null }: SaveCallResultParams) =>
  post<MyCallList & { AttemptId: number }>(CALLING_ENDPOINTS.saveResult, { ContactId, Result, Notes, DialedAt, CallbackAt });

export interface ConvertCallContactParams {
  ContactId: number;
  Name: string;
  Notes?: string | null;
  /** "yyyy-MM-dd" or "yyyy-MM-ddTHH:mm". */
  FirstFollowupAt: string;
  DialedAt?: string | null;
}

/** "Interested": the server copies number, source and office from the contact. */
export const convertCallContact = ({ ContactId, Name, Notes = null, FirstFollowupAt, DialedAt = null }: ConvertCallContactParams) =>
  post<MyCallList & { LeadId: number }>(CALLING_ENDPOINTS.convert, { ContactId, Name, Notes, FirstFollowupAt, DialedAt });

/** A wrong tap, within two minutes. */
export const undoCallResult = (AttemptId: number) => post<MyCallList>(CALLING_ENDPOINTS.undoResult, { AttemptId });
