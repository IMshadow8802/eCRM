import { useState } from "react";
import { CalendarCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { Modal, Button, DateField, TextArea, Tooltip } from "../../components/ui";
import { FormSelect } from "../../components/Design/FormComponents";
import { saveDayMark, deleteDayMark } from "../../api/workQueries";

const PARTS = [
  { value: "full", label: "Full day" },
  { value: "first_half", label: "First half (morning)" },
  { value: "second_half", label: "Second half (afternoon)" },
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
      setError(e?.response?.data?.message || e?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };
  const key = { UserId: person?.UserId, WorkDate: day };

  return (
    <Modal open={open} onClose={onClose} size="sm" data-testid="day-mark-dialog">
      <Modal.Header title="Mark leave or on duty" subtitle={person?.FullName} icon={<CalendarCheck size={18} />} onClose={onClose} />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: "calc(12rem / 15)" }}>
          <DateField label="Date" value={day} onChange={setDay} required data-testid="day-mark-date" />
          <Tooltip title="Full day, or only the first or second half. Half-day leave means the person still works the other half.">
            <div><FormSelect label="For" options={PARTS} value={part} onChange={(e) => setPart(e.target.value)} data-testid="day-mark-part" /></div>
          </Tooltip>
          <Tooltip title="On leave: the person is off, so they are not counted late or absent. On duty: working away from the office (a client visit, for example). It counts as present.">
            <div><FormSelect label="Type" options={KINDS} value={kind} onChange={(e) => setKind(e.target.value)} data-testid="day-mark-kind" /></div>
          </Tooltip>
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
