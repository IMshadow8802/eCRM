import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import dayjs from "dayjs";

import { Modal, Button, Combobox, TextArea, DateField, NumberInput } from "../../components/ui";
import FormGrid from "../../components/ui/FormGrid";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useLookups } from "../../hooks/useLookups";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { FOLLOWUP_TYPES, DIRECTIONS } from "./leadStatus";

/**
 * Completes an open follow-up: what happened (outcome), what was said
 * (remarks — required; the table's CHECK enforces it too), and optionally the
 * next one. A call also records direction and minutes.
 */
export default function LogFollowUpModal({ open, onClose, followUp, onLogged }) {
  const [outcome, setOutcome] = useState(null);
  const [remarks, setRemarks] = useState("");
  const [direction, setDirection] = useState(DIRECTIONS[0]);
  const [duration, setDuration] = useState("");
  const [nextType, setNextType] = useState(FOLLOWUP_TYPES[0]);
  const [nextDate, setNextDate] = useState("");

  const isCall = followUp?.Type === "call";
  const { lookups: outcomes } = useLookups("call_outcome", { enabled: open, showErrorMessage: false });
  const outcomeOptions = outcomes.map((o) => ({ value: o.Id, label: o.Value }));

  useEffect(() => {
    if (!open) return;
    setOutcome(null); setRemarks(""); setDirection(DIRECTIONS[0]); setDuration("");
    setNextType(FOLLOWUP_TYPES[0]); setNextDate("");
  }, [open, followUp?.Id]);

  const mutation = useApiMutation({
    endpoint: SALES_ENDPOINTS.followups.completeFollowUp,
    successMessage: "Follow-up logged",
    invalidateQueries: [["followups"], ["lead-detail"], ["leads"]],
  });

  const ready = Boolean(remarks.trim());
  const submit = async () => {
    if (!ready) return;
    try {
      await mutation.mutateAsync({
        Id: followUp.Id,
        OutcomeId: outcome?.value ?? null,
        Remarks: remarks.trim(),
        Direction: isCall ? direction?.value ?? null : null,
        Duration: isCall && duration !== "" ? Number(duration) : null,
        NextType: nextDate ? nextType?.value ?? "call" : null,
        NextDueAt: nextDate || null,
      });
      onLogged?.();
      onClose?.();
    } catch {
      // useApiMutation already surfaced the server's message.
    }
  };

  const due = followUp?.DueAt ? dayjs(followUp.DueAt).format("DD-MM-YYYY") : "";
  const typeLabel = FOLLOWUP_TYPES.find((t) => t.value === followUp?.Type)?.label ?? "Follow-up";

  return (
    <Modal open={open} onClose={onClose} size="lg" data-testid="log-followup-modal">
      <Modal.Header title={`Log ${typeLabel}${due ? ` · due ${due}` : ""}`} icon={<CheckCircle2 size={18} />} onClose={onClose} />
      <Modal.Body>
        <FormGrid>
          <Combobox label="Outcome" options={outcomeOptions} value={outcome} onChange={setOutcome} placeholder="What happened?" data-testid="followup-outcome" />
          {isCall && (
            <>
              <Combobox label="Direction" options={DIRECTIONS} value={direction} onChange={setDirection} data-testid="followup-direction" />
              <NumberInput label="Minutes" value={duration} onChange={(e) => setDuration(e.target.value)} data-testid="followup-duration" />
            </>
          )}
          <div style={{ gridColumn: "1 / -1" }}>
            <TextArea
              label="Remarks"
              required
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Exactly what was discussed — the next person reads this"
              data-testid="followup-remarks"
            />
          </div>
          <Combobox label="Next follow-up" options={FOLLOWUP_TYPES} value={nextType} onChange={setNextType} data-testid="followup-next-type" />
          <DateField label="Next date" value={nextDate} onChange={setNextDate} data-testid="followup-next-date" />
        </FormGrid>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={!ready} loading={mutation.isPending} data-testid="followup-submit">
          Log follow-up
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
