import { useEffect, useRef, useState } from "react";
import { CalendarClock } from "lucide-react";
import dayjs from "dayjs";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Modal, Button, TextArea } from "../../components/ui";
import FormGrid from "../../components/ui/FormGrid";
import { scheduleFollowUp, skipFollowUp } from "../../api/salesQueries";
import { formatDue } from "../../utils/format";
import { dueAt, isPastDue } from "./followUpDue";
import DueInputs from "./DueInputs";

const prefillTime = (value) => {
  const d = dayjs(value);
  return value && d.isValid() && (d.hour() || d.minute()) ? d.format("HH:mm") : "";
};

/**
 * Moves an open follow-up to a new day (and optional time): books the new one
 * first, then skips the old one with the reason — so a failure never loses it.
 * Same semantics as mobile FollowUpSheets' reschedule.
 */
export default function RescheduleFollowUpModal({ open, followUp, onClose, onDone }) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState("");
  // { id, due } of the follow-up whose replacement is already booked. Not reset
  // on reopen, so a retry after a half failure never books twice.
  const rebooked = useRef(null);

  useEffect(() => {
    if (!open) return;
    setDate(""); setTime(prefillTime(followUp?.DueAt)); setRemarks(""); setError("");
  }, [open, followUp?.Id]);

  const mutation = useMutation({
    mutationFn: async ({ f, due, note }) => {
      let booked = rebooked.current?.id === f.Id ? rebooked.current : null;
      if (!booked) {
        await scheduleFollowUp({ LeadId: f.LeadId, Type: f.Type ?? "call", DueAt: due, AssignedTo: f.AssignedTo ?? null });
        booked = rebooked.current = { id: f.Id, due };
      }
      try {
        await skipFollowUp({ Id: f.Id, Remarks: `Rescheduled to ${formatDue(booked.due)}: ${note}` });
      } catch {
        throw new Error("Booked the new follow-up, but the old one is still open — skip it from the lead.");
      }
    },
    // A half failure has still booked, so refresh either way.
    onSettled: () => {
      for (const key of ["followups", "lead-detail", "leads"]) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });

  const ready = Boolean(date) && Boolean(remarks.trim()) && !isPastDue(date, time);
  const submit = async () => {
    if (!ready) return;
    setError("");
    try {
      await mutation.mutateAsync({ f: followUp, due: dueAt(date, time), note: remarks.trim() });
      onDone?.();
      onClose?.();
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || "Could not reschedule the follow-up.");
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="sm" data-testid="reschedule-followup-modal">
      <Modal.Header title="Reschedule follow-up" icon={<CalendarClock size={18} />} onClose={onClose} />
      <Modal.Body>
        <FormGrid>
          <DueInputs dateLabel="New date" required date={date} time={time} onDateChange={setDate} onTimeChange={setTime} dateTestId="reschedule-date" timeTestId="reschedule-time" />
          <div style={{ gridColumn: "1 / -1" }}>
            <TextArea label="Remarks" required value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Why it moved" data-testid="reschedule-remarks" />
          </div>
          {error && <div role="alert" style={{ gridColumn: "1 / -1", color: "#DC2626", fontSize: "calc(13rem / 15)" }} data-testid="reschedule-error">{error}</div>}
        </FormGrid>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={!ready} loading={mutation.isPending} data-testid="reschedule-submit">
          Reschedule
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
