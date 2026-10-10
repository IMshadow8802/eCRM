import { useState } from "react";
import { AlertOctagon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { Modal, Button, Combobox, TextArea } from "../../../../components/ui";
import { useLookups } from "../../../../hooks/useLookups";
import { useApiMutation } from "../../../../hooks/useApiMutation";
import { TAT_ENDPOINTS } from "../../../../api/tatQueries";

// Why a breached clock ran over. Never blocking: "Later" just closes, and the
// clock stays "Missed deadline – say why" on Today until a reason is given.
export default function BreachReasonDialog({ open, tatId, taskId, onClose }) {
  const queryClient = useQueryClient();
  const { lookups } = useLookups("task_breach_reason", { enabled: open, showErrorMessage: false });
  const options = lookups.map((l) => ({ value: l.Id, label: l.Value, code: l.Code }));
  const [reason, setReason] = useState(null);
  const [remarks, setRemarks] = useState("");
  const save = useApiMutation({ endpoint: TAT_ENDPOINTS.saveReason, successMessage: "Reason saved" });

  const needsRemarks = reason?.code === "other";
  const canSave = Boolean(reason) && (!needsRemarks || remarks.trim().length > 0);

  const close = () => {
    setReason(null);
    setRemarks("");
    onClose?.();
  };
  const submit = async () => {
    try {
      await save.mutateAsync({ TaskId: taskId, TatId: tatId, ReasonId: reason.value, Remarks: remarks.trim() || null });
      queryClient.invalidateQueries({ queryKey: ["tasks"], refetchType: "all" });
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      close();
    } catch {
      /* useApiMutation already showed why */
    }
  };

  return (
    <Modal open={open} onClose={close} size="sm" data-testid="breach-reason-dialog">
      <Modal.Header
        title="This task missed its deadline"
        subtitle="Say why, so your manager sees the reason with the delay."
        icon={<AlertOctagon size={18} />}
        onClose={close}
      />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: "calc(12rem / 15)" }}>
          <Combobox
            label="Reason"
            options={options}
            value={reason}
            onChange={(v) => setReason(v ?? null)}
            required
            data-testid="breach-reason-select"
          />
          <TextArea
            label="Remarks"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            required={needsRemarks}
            hint={needsRemarks ? "Required for Other" : undefined}
            data-testid="breach-reason-remarks"
          />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={close} data-testid="breach-reason-later">
          Later
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={!canSave}
          loading={save.isPending}
          data-testid="breach-reason-save"
        >
          Save reason
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
