import { Card, Chip } from "../../components/ui";
import { useAccess } from "../../hooks/useAccess";
import { COMMISSION_STATUS, formatCommission } from "../../api/partnerQueries";
import { formatCurrency, formatDate } from "../../utils/format";

/**
 * Who sent this lead and, for people who may see money, what it earns them.
 * Everything comes from the lead detail response (`lead` + `commissions`) —
 * no request of its own. Renders nothing for a lead no partner sent.
 */
export default function LeadPartnerCard({ lead, commissions = [] }) {
  const canSee = useAccess("partners").view;
  if (!lead?.PartnerId) return null;
  const terms = formatCommission(lead.CommType, lead.CommValue);
  const latest = commissions[0];
  const status = latest && (COMMISSION_STATUS[latest.Status] ?? COMMISSION_STATUS.cancelled);

  return (
    <Card data-testid="lead-partner-card">
      <div style={{ fontSize: "calc(14rem / 15)", fontWeight: 700 }}>Sent by {lead.PartnerName}</div>
      {canSee && (
        <div style={{ marginTop: "calc(8rem / 15)", display: "flex", flexDirection: "column", gap: "calc(6rem / 15)", fontSize: "calc(13rem / 15)" }}>
          <div>Commission: {terms === "—" ? "None" : terms}</div>
          {latest && (
            <div style={{ display: "flex", alignItems: "center", gap: "calc(8rem / 15)", flexWrap: "wrap" }} data-testid="partner-commission">
              <strong>{formatCurrency(latest.Amount)}</strong>
              <Chip size="sm" tone={status.tone} label={status.label} />
              {latest.Reverted && <Chip size="sm" tone="warning" label="Lead no longer converted" />}
              {latest.Status === "paid" && (
                <span>Paid {formatDate(latest.PaidAt)}{latest.PaidRef ? ` · ${latest.PaidRef}` : ""}</span>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
