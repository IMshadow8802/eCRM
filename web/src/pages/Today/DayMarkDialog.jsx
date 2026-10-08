import { useState } from "react";
import { CalendarCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { Modal, Button, DateField, TextArea } from "../../components/ui";
import { FormSelect } from "../../components/Design/FormComponents";
import { saveDayMark, deleteDayMark } from "../../api/workQueries";

const PARTS = [
  { value: "full", label: "Full day" },
  { value: "first_half", label: "First half" },
  { value: "second_half", label: "Second half" },
];
const KINDS = [
  { value: "leave", label: "On leave" },
  { value: "on_duty", label: "On duty" },
];

// A manager marks the day; no apply/approve flow. The server decides who may (403 shown here).
export default function DayMarkDialog({ open, person, date, onClose }) {
  const queryClient = useQueryClient();
  const existing = person?.MarkKind ? person : null;
  const [day, setDay] = useState(date);
  const [part, setPart] = useState(existing?.MarkPart ?? "full");
  const [kind, setKind] = useState(existing?.MarkKind ?? "leave");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (call, body) => {
    setBusy(true);
    setError("");
    try {
      await call(body);
      queryClient.invalidateQueries({ queryKey: ["today"] });
      onClose?.();
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || "Could not save the mark");
    } finally {
      setBusy(false);
    }
  };
  const key = { UserId: person?.UserId, WorkDate: day };

  return (
    <Modal open={open} onClose={onClose} size="sm" data-testid="day-mark-dialog">
      <Modal.Header title="Mark day" subtitle={person?.FullName} icon={<CalendarCheck size={18} />} onClose={onClose} />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <DateField label="Date" value={day} onChange={setDay} required data-testid="day-mark-date" />
          <FormSelect label="Part of day" options={PARTS} value={part} onChange={(e) => setPart(e.target.value)} data-testid="day-mark-part" />
          <FormSelect label="Mark as" options={KINDS} value={kind} onChange={(e) => setKind(e.target.value)} data-testid="day-mark-kind" />
          <TextArea label="Remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          {error && <div role="alert" data-testid="day-mark-error">{error}</div>}
        </div>
      </Modal.Body>
      <Modal.Footer>
        {existing && (
          <Button variant="ghost" disabled={busy} onClick={() => run(deleteDayMark, key)} data-testid="day-mark-remove">
            Remove mark
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!day} onClick={() => run(saveDayMark, { ...key, Part: part, Kind: kind, Remarks: remarks.trim() || null })} data-testid="day-mark-save">
          Save
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
