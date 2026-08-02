/**
 * Time-of-day greeting for the home header.
 *
 * Uses the device's LOCAL hour deliberately — the server runs IST, but the
 * greeting is about the person holding the phone, not about the database.
 */
export function greetingFor(now = new Date()): { text: string; emoji: string } {
  const hour = now.getHours();
  if (hour < 5) return { text: "Working late", emoji: "🌙" };
  if (hour < 12) return { text: "Good morning", emoji: "☀️" };
  if (hour < 17) return { text: "Good afternoon", emoji: "🌤️" };
  if (hour < 21) return { text: "Good evening", emoji: "🌆" };
  return { text: "Good night", emoji: "🌙" };
}

/** "Saturday, 2 August" — the long form reads better under a big greeting. */
export function longDate(now = new Date()): string {
  return now.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
