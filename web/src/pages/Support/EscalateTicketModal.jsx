// src/pages/Support/EscalateTicketModal.jsx
import { useEffect, useState } from "react";
import { Flag } from "lucide-react";

import { Modal, Button, Combobox, TextArea } from "../../components/ui";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";

/**
 * Flag a senior (spec 2 §2). The complaint stays with its assignee — this is
 * a shout for help, not a reassignment — and the senior gets an in-app
 * notification.
 *
 * The chain is the holder's, not the caller's: the server answers it for the
 * complaint (`{ TicketId }`), listing only people above the holder who can
 * open complaints. An empty chain says so instead of offering an empty select.
 */
export default function EscalateTicketModal({ open, onClose, ticket, onDone, onError }) {
  const [target, setTarget] = useState(null);
  const [remarks, setRemarks] = useState("");

  useEffect(() => {
    if (!open) return;
    setTarget(null);
    setRemarks("");
  }, [open]);

  const ticketId = ticket?.Id ?? null;
  const { data, isLoading } = useApiQuery({
    queryKey: ["escalation-targets", "ticket", ticketId],
    endpoint: SUPPORT_ENDPOINTS.tickets.fetchEscalationTargets,
    params: { TicketId: ticketId },
    enabled: open && Boolean(ticketId),
    showErrorMessage: false,
  });
  const holder = ticket?.AssigneeName || "you";
  const nobody = !isLoading && data && (data.users ?? []).length === 0;
  // Nearest first — the SP orders by Depth, so the list is already the chain.
  const options = (data?.users ?? []).map((u) => ({
    value: u.Id,
    label: u.JobTitle ? `${u.FullName} · ${u.JobTitle}` : u.FullName,
  }));

  const mutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.tickets.escalateTicket,
    successMessage: "Complaint escalated",
    showErrorMessage: !onError,
    onError,
    invalidateQueries: [["tickets"], ["ticket-detail"]],
  });

  const ready = Boolean(target && remarks.trim());
  const handleClose = () => { if (mutation.isPending) return; onClose?.(); };

  const submit = async () => {
    if (!ready) return;
    try {
      await mutation.mutateAsync({ TicketId: ticket?.Id, ToUserId: target.value, Remarks: remarks.trim() });
      onDone?.();
      onClose?.();
    } catch {
      // useApiMutation already surfaced the SP's message (closed complaint,
      // target not a senior of the assignee).
    }
  };

  return (
    <Modal open={open} onClose={handleClose} size="sm" data-testid="escalate-ticket-modal">
      <Modal.Header
        title="Escalate complaint"
        subtitle="It stays with you — the senior is notified and sees it in their Escalated tab."
        icon={<Flag size={18} />}
        onClose={handleClose}
      />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: "calc(16rem / 15)" }}>
          {nobody ? (
            <div data-testid="escalate-nobody" style={{ fontSize: "calc(14rem / 15)" }}>
              Nobody above {holder} can open complaints. Reassign it or tell a manager.
            </div>
          ) : (
            <Combobox
              label="Escalate to"
              required
              options={options}
              value={target}
              onChange={setTarget}
              placeholder={`Someone above ${holder}`}
              data-testid="escalate-target"
            />
          )}
          <TextArea
            label="Remarks"
            required
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={4}
            placeholder="Why this needs them"
            data-testid="escalate-remarks"
          />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={mutation.isPending}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={!ready} loading={mutation.isPending} data-testid="escalate-submit">
          Escalate
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
