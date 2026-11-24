// A lead / complaint / follow-up call answered 404 NOT_FOUND: the record left
// this user (reassigned, moved, deleted) while the screen was open. Callers drop
// the cached detail, go back to the list and show RECORD_GONE_MESSAGE. The code
// matters: only the record's own not-found carries NOT_FOUND (the access gates,
// and a procedure's 404), so any other 404 — a proxy page, a missing route —
// never throws the user out of a record they can still see. A 403 means the
// record is still visible but the action was refused: show the server's message
// and stay.
export const RECORD_GONE_MESSAGE = "This record is no longer with you";

export const recordGone = (error) =>
  error?.response?.status === 404 && error?.response?.data?.code === "NOT_FOUND";
