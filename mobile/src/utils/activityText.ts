/**
 * Activity summaries are stored text (sp_LogTicketActivity / sp_LogLeadActivity).
 * Rows written before the access model say "Transferred to <name> — <reason>";
 * the screens now say "Reassigned". Reworded on display, history untouched.
 * Same rule as web/src/pages/Sales/Timeline.jsx.
 */
export function activityText(summary: string): string;
export function activityText(summary: string | null | undefined): string | undefined;
export function activityText(summary: string | null | undefined) {
  return summary?.replace(/^Transferred to /i, "Reassigned to ");
}
