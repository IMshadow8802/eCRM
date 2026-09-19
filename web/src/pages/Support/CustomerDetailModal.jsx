// src/pages/Support/CustomerDetailModal.jsx
import { useNavigate } from "react-router-dom";
import { useTheme } from "@mui/material/styles";
import { Inbox, Pencil } from "lucide-react";

import { Modal, Button, Card, Chip, EmptyState, Skeleton } from "../../components/ui";
import { useApiQuery } from "../../hooks/useApiQuery";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { formatDate } from "../../utils/format";
import { statusTone, dueLabel } from "./ticketStatus";

function Fact({ label, value }) {
  const p = useTheme().tokens;
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 500, color: p.text.tertiary }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2, color: p.text.primary, overflowWrap: "anywhere" }}>{value || "—"}</div>
    </div>
  );
}

/**
 * A customer's profile and every complaint they raised that the caller may
 * see (sp_FetchCustomerDetail RS2 applies the ticket scope predicate — a Self
 * agent sees only their own). Rows open the complaint; Edit hands the row to
 * the page, which swaps this modal for the form.
 */
export default function CustomerDetailModal({ customerId, open, onClose, onEdit }) {
  const navigate = useNavigate();
  const p = useTheme().tokens;

  const { data, isLoading } = useApiQuery({
    queryKey: ["customer-detail", customerId],
    endpoint: SUPPORT_ENDPOINTS.customers.fetchCustomerDetail,
    params: { CustomerId: customerId },
    enabled: open && Boolean(customerId),
    showErrorMessage: false,
  });
  const customer = data?.customer ?? null;
  const tickets = data?.tickets ?? [];
  const address = customer ? [customer.Address, customer.City, customer.State, customer.Pincode].filter(Boolean).join(", ") : "";

  return (
    <Modal open={open} onClose={onClose} size="lg" data-testid="customer-detail-modal">
      <Modal.Header
        title={customer?.Name ?? "Customer"}
        subtitle={customer ? [customer.ContactPerson, customer.Mobile, customer.Email].filter(Boolean).join(" · ") : undefined}
        onClose={onClose}
      />
      <Modal.Body>
        {isLoading || !customer ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="customer-detail-loading">
            <Skeleton variant="text" height={24} width={240} />
            <Skeleton variant="rect" height={120} />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Card data-testid="customer-profile">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 16 }}>
                <Fact label="Mobile" value={customer.Mobile} />
                <Fact label="Alternate" value={customer.AltMobile} />
                <Fact label="Email" value={customer.Email} />
                <Fact label="Branch" value={customer.BranchName} />
                <Fact label="Customer since" value={formatDate(customer.CreatedAt)} />
                <Fact label="Open / total" value={`${customer.OpenTickets ?? 0} / ${customer.TotalTickets ?? 0}`} />
              </div>
              {(address || customer.Remarks) && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 16, marginTop: 16 }}>
                  <Fact label="Address" value={address} />
                  <Fact label="Remarks" value={customer.Remarks} />
                </div>
              )}
            </Card>

            <div>
              <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700 }}>Complaints ({tickets.length})</h3>
              {tickets.length === 0 ? (
                <EmptyState
                  icon={<Inbox size={24} />}
                  title="No complaints"
                  description="Nothing raised by this customer that you can see."
                  size="sm"
                  data-testid="customer-tickets-empty"
                />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {tickets.map((t) => (
                    <Card
                      key={t.Id}
                      padding="sm"
                      onClick={() => navigate(`/support/tickets/${t.Id}`)}
                      data-testid={`customer-ticket-${t.Id}`}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: p.text.tertiary }}>{t.TicketNo}</span>
                        <span style={{ flex: 1, minWidth: 160, fontSize: 14, fontWeight: 600 }}>{t.Subject}</span>
                        <Chip label={t.StatusName || "—"} size="sm" tone={statusTone(t.StatusCode)} />
                        {t.PriorityName && <Chip label={t.PriorityName} size="sm" tone="accent" />}
                        <span style={{ fontSize: 12, color: t.IsOverdue ? p.error.main : p.text.secondary, fontWeight: t.IsOverdue ? 600 : 500 }}>
                          {dueLabel(t.DueAt, t.IsOverdue)}
                        </span>
                        <span style={{ fontSize: 12, color: p.text.secondary }}>{t.AssigneeName || "Unassigned"}</span>
                        <span style={{ fontSize: 12, color: p.text.tertiary }}>{formatDate(t.CreatedAt)}</span>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {customer && onEdit && (
          <Button variant="tonal" leftIcon={<Pencil size={14} />} onClick={() => onEdit(customer)} data-testid="customer-detail-edit">
            Edit
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}
