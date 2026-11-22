// A lead / complaint / follow-up call answered 403 or 404: the record left this
// user (reassigned, moved, deleted) while the screen was open. Callers drop the
// cached detail, go back to the list and show RECORD_GONE_MESSAGE.
export const RECORD_GONE_MESSAGE = "This record is no longer with you";

export const recordGone = (error) => [403, 404].includes(error?.response?.status);
