// A lead / complaint / follow-up call answered 404: the record left this user
// (reassigned, moved, deleted) while the screen was open. Callers drop the
// cached detail, go back to the list and show RECORD_GONE_MESSAGE. A 403 means
// the record is still visible but the action was refused: show the server's
// message and stay.
export const RECORD_GONE_MESSAGE = "This record is no longer with you";

export const recordGone = (error) => error?.response?.status === 404;
