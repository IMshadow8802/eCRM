// src/api/callingQueries.js — calling lists (149) and do-not-call marks.
// Endpoints only: pages call them through useApiQuery / useApiMutation / useServerTable.
// The calling report rides SALES_ENDPOINTS.reports (no report endpoint of its own).

const names = (base, list) => Object.fromEntries(list.map((n) => [n, `${base}/${n}`]));

export const CALLING_ENDPOINTS = names("/api/calling", [
  "fetchLists", "saveList", "deleteList", "saveCallers", "importContacts", "addContact",
  "fetchContacts", "contactHistory", "assign", "recall", "setState",
]);
export const PHONE_MARK_ENDPOINTS = names("/api/phoneMark", ["fetch", "set", "clear"]);

// tblCallContact.Status — the only branching key on a contact.
export const CONTACT_STATUS = {
  pool: { label: "In pool", tone: "default" },
  held: { label: "With caller", tone: "info" },
  callback: { label: "Callback", tone: "warning" },
  lead: { label: "Lead", tone: "success" },
  closed: { label: "Closed", tone: "default" },
};
export const CALL_RESULT = {
  interested: "Interested", not_interested: "Not interested", wrong_number: "Wrong number",
  no_answer: "No answer", busy: "Busy", callback: "Call back", dnc: "Do not call",
};
export const CLOSE_REASON = {
  not_interested: "Not interested", wrong_number: "Wrong number", dnc: "Do not call",
  no_response: "No response", duplicate: "Already a lead or customer", removed: "Removed",
};
export const LIST_STATUS = {
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "default" },
  archived: { label: "Archived", tone: "default" },
};

// sp_SaveCallList overwrites every field on an edit, so an edit sends the whole
// list with the changes on top. The server keeps Cost for a non-admin (who reads it as null).
const LIST_FIELDS = ["Id", "BranchId", "Name", "Vendor", "PurchasedOn", "Cost", "ProductId", "Script",
  "AutoTopUp", "HoldSize", "MaxAttempts", "RetryGapHours", "Status"];
export const listBody = (list, over = {}) => {
  const out = Object.fromEntries(LIST_FIELDS.map((k) => [k, list?.[k] ?? null]));
  if (out.PurchasedOn) out.PurchasedOn = String(out.PurchasedOn).slice(0, 10);
  out.AutoTopUp = Boolean(out.AutoTopUp);
  return { ...out, ...over };
};

// A list with nothing eligible and nothing in the pool is used up: time to buy more.
export const usedUp = (l) => l.Status === "active" && Number(l.Eligible) === 0 && Number(l.InPool) === 0;
