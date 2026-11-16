import dayjs from "dayjs";

/** Naive local "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" (no zone), or "" when there is no date. */
export const dueAt = (date, time) => (!date ? "" : time ? `${date}T${time}` : date);

/** Timed: before this minute. Day-only: before today. */
export function isPastDue(date, time, now = dayjs()) {
  if (!date) return false;
  return time
    ? dayjs(`${date}T${time}`).isBefore(now.startOf("minute"))
    : date < now.format("YYYY-MM-DD");
}
