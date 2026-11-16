import { useState } from "react";
import { PhoneCall } from "lucide-react";

import { Modal, Button, Combobox, TextArea } from "../../components/ui";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useLookups } from "../../hooks/useLookups";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

/**
 * Logs a manual call against a lead OR a ticket: outcome (from the
 * `call_outcome` lookup), and free-text notes. Pass either `leadId` (sales) or `ticketId` (support) — exactly one.
 */
export default function LogCallModal({ open, onClose, leadId, ticketId, onLogged }) {
  const [outcome, setOutcome] = useState(null);
  const [notes, setNotes] = useState("");

  const { lookups } = useLookups("call_outcome", {
    enabled: Boolean(open),
    showErrorMessage: false,
  });
  const outcomeOptions = lookups.map((l) => ({ value: l.Id, label: l.Value }));

  const logCallMutation = useApiMutation({
    endpoint: SALES_ENDPOINTS.calls.logCall,
    successMessage: "Call logged",
  });

  const reset = () => {
    setOutcome(null);
    setNotes("");
  };

  const handleClose = () => {
    reset();
    onClose?.();
  };

  const submit = async () => {
    try {
      const trimmedNotes = notes.trim() || null;
      await logCallMutation.mutateAsync({
        LeadId: leadId ?? null,
        TicketId: ticketId ?? null,
        OutcomeId: outcome?.value ?? null,
        Notes: trimmedNotes,
        Direction: "out",
        FollowupRemarks: trimmedNotes,
      });
      reset();
      onLogged?.();
      onClose?.();
    } catch {
      // useApiMutation already surfaced an error toast.
    }
  };

  return (
    <Modal open={open} onClose={handleClose} size="sm" data-testid="log-call-modal">
      <Modal.Header title="Log Call" icon={<PhoneCall size={18} />} onClose={handleClose} />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: "calc(14rem / 15)" }}>
          <Combobox
            label="Outcome"
            options={outcomeOptions}
            value={outcome}
            onChange={setOutcome}
            placeholder="Pick a call outcome"
            data-testid="log-call-outcome"
          />
          <TextArea
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="What happened on the call?"
            data-testid="log-call-notes"
          />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={logCallMutation.isPending}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          loading={logCallMutation.isPending}
          data-testid="log-call-submit"
        >
          Log Call
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
