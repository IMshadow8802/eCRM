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
 * The chain is the ASSIGNEE's, not the caller's: sp_EscalateTicket requires
 * the target to be an ancestor of whoever holds the complaint (of the caller
 * when nobody does, which is what ForUserId = null asks the controller for).
 */
export default function EscalateTicketModal({ open, onClose, ticket, onDone }) {
  const [target, setTarget] = useState(null);
  const [remarks, setRemarks] = useState("");

  useEffect(() => {
    if (!open) return;
    setTarget(null);
    setRemarks("");
  }, [open]);

  const forUserId = ticket?.AssignedTo ?? null;
  const { data } = useApiQuery({
    queryKey: ["escalation-targets", forUserId],
    endpoint: SUPPORT_ENDPOINTS.tickets.fetchEscalationTargets,
    params: { ForUserId: forUserId },
    enabled: open,
    showErrorMessage: false,
  });
  // Nearest first — the SP orders by Depth, so the list is already the chain.
  const options = (data?.users ?? []).map((u) => ({
    value: u.Id,
    label: u.JobTitle ? `${u.FullName} · ${u.JobTitle}` : u.FullName,
  }));

  const mutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.tickets.escalateTicket,
    successMessage: "Complaint escalated",
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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Combobox
            label="Escalate to"
            required
            options={options}
            value={target}
            onChange={setTarget}
            placeholder="Someone above the assignee"
            noOptionsText="Nobody senior to escalate to"
            data-testid="escalate-target"
          />
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
