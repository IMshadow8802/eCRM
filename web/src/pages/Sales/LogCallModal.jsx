import { useState } from "react";
import { PhoneCall } from "lucide-react";

import { Modal, Button, Combobox, TextArea, DateField } from "../../components/ui";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

/**
 * Logs a manual call against a lead: outcome (from the `call_outcome`
 * lookup), free-text notes, and an optional next-follow-up date.
 */
export default function LogCallModal({ open, onClose, leadId, onLogged }) {
  const [outcome, setOutcome] = useState(null);
  const [notes, setNotes] = useState("");
  const [nextFollowupDate, setNextFollowupDate] = useState("");

  const { data: lookupsPayload } = useApiQuery({
    queryKey: ["lookups", "call_outcome"],
    endpoint: SALES_ENDPOINTS.config.fetchLookups,
    params: { Kind: "call_outcome" },
    enabled: Boolean(open),
    showErrorMessage: false,
  });
  const outcomeOptions = (lookupsPayload?.lookups ?? []).map((l) => ({
    value: l.Id,
    label: l.Value,
  }));

  const logCallMutation = useApiMutation({
    endpoint: SALES_ENDPOINTS.calls.logCall,
    successMessage: "Call logged",
  });

  const reset = () => {
    setOutcome(null);
    setNotes("");
    setNextFollowupDate("");
  };

  const handleClose = () => {
    reset();
    onClose?.();
  };

  const submit = async () => {
    try {
      const trimmedNotes = notes.trim() || null;
      await logCallMutation.mutateAsync({
        LeadId: leadId,
        OutcomeId: outcome?.value ?? null,
        Notes: trimmedNotes,
        Direction: "out",
        NextFollowupDate: nextFollowupDate || null,
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
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
          <DateField
            label="Next follow-up (optional)"
            value={nextFollowupDate}
            onChange={setNextFollowupDate}
            data-testid="log-call-followup-date"
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
