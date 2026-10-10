import { formatCurrency } from "../utils/format";

export const PARTNER_ENDPOINTS = {
  fetchPartners: "/api/partners/fetchPartners",
  savePartner: "/api/partners/savePartner",
  fetchCommissions: "/api/partners/fetchCommissions",
  setCommissionStatus: "/api/partners/setCommissionStatus",
};

/** One commission's status in plain words + chip tone — shared by the Commissions tab and the lead page. */
export const COMMISSION_STATUS = {
  earned: { label: "Earned", tone: "info" },
  due: { label: "Ready to pay", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  cancelled: { label: "Cancelled", tone: "default" },
};

/** "10%" | "₹5,000" | "—" — a partner's (or one commission's) terms in plain words. */
export function formatCommission(CommType, CommValue) {
  if (CommValue === null || CommValue === undefined || CommValue === "") return "—";
  if (CommType === "pct") return `${Number(CommValue)}%`;
  if (CommType === "fixed") return formatCurrency(CommValue).replace(/\.00$/, "");
  return "—";
}
