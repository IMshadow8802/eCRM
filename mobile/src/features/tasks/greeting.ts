/**
 * Time-of-day greeting for the home header.
 *
 * Uses the device's LOCAL hour deliberately — the server runs IST, but the
 * greeting is about the person holding the phone, not about the database.
 */
export function greetingFor(now = new Date()): string {
  // Text only. The wave beside it is lucide's `Hand`, drawn by the header —
  // no emoji in UI (they render differently per OS and ignore our colours).
  const hour = now.getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

/** "Saturday, 2 August" — the long form reads better under a big greeting. */
export function longDate(now = new Date()): string {
  return now.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
