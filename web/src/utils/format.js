// src/utils/format.js
//
// Display formatting for dates and money. One definition each, because there
// were seven and they DISAGREED — this was never only about duplication.
//
//   formatDate      Sales rendered DD-MMM-YYYY ("05-Aug-2026"), Master rendered
//                   DD-MM-YYYY ("05-08-2026"). The same date looked different
//                   depending on which page you opened.
//
//   formatCurrency  Leads and Projects used Intl.NumberFormat and showed
//                   "₹1,23,456.00"; PipelineCard hand-rolled a ₹ prefix and
//                   showed "₹1,23,456". So a lead's value gained and lost its
//                   paisa depending on whether you were looking at the table or
//                   at that lead's own card.
//
// Resolved 2026-08-05: DD-MM-YYYY and decimals-always.

import dayjs from "dayjs";

/**
 * A date for display. Invalid input returns the empty string rather than
 * throwing or rendering "Invalid Date" into a table cell.
 *
 * `empty` is a parameter because a table cell and a detail field want different
 * things from a missing value — but it defaults to "" so a caller that says
 * nothing gets the same answer everywhere.
 */
export function formatDate(value, { empty = "" } = {}) {
  if (!value) return empty;
  const d = dayjs(value);
  return d.isValid() ? d.format("DD-MM-YYYY") : empty;
}

/** A date with its time, for activity logs and audit trails. */
export function formatDateTime(value, { empty = "" } = {}) {
  if (!value) return empty;
  const d = dayjs(value);
  return d.isValid() ? d.format("DD-MM-YYYY HH:mm") : empty;
}

/**
 * Indian-format currency: ₹1,23,456.00 — lakh/crore grouping, two decimals.
 *
 * Intl does the grouping, which is the part worth not hand-rolling: en-IN
 * groups as 1,23,456 rather than 123,456, and the version that built the string
 * with a template literal only got that right by delegating to toLocaleString
 * anyway — while losing the decimals.
 */
export function formatCurrency(amount, { empty = "" } = {}) {
  if (amount === null || amount === undefined || amount === "") return empty;
  const n = Number(amount);
  if (!Number.isFinite(n)) return empty;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(n);
}
