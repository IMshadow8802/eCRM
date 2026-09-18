// src/pages/Support/ResolveTicketModal.jsx
import { useEffect, useState } from "react";
import { CheckCircle } from "lucide-react";

import { Modal, Button, Combobox, TextArea } from "../../components/ui";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useLookups } from "../../hooks/useLookups";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";

/**
 * The resolution + remarks a complaint needs before it can leave the active
 * statuses (spec 2 §2): 'resolved' always, and 'closed' when it is moving
 * straight there from open/onhold. sp_SetTicketStatus refuses without either.
 *
 * `status` is the option the user actually picked, not "the first resolved
 * one" — a company may define two resolved-coded statuses, and this is the
 * whole reason every move goes through sp_SetTicketStatus rather than the
 * sp_ResolveTicket shortcut.
 */
export default function ResolveTicketModal({ open, onClose, ticket, status, onDone }) {
  const [resolution, setResolution] = useState(null);
  const [remarks, setRemarks] = useState("");

  useEffect(() => {
    if (!open) return;
    setResolution(null);
    setRemarks("");
  }, [open]);

  const { lookups: resolutions } = useLookups("resolution", { enabled: open, showErrorMessage: false });
  const options = resolutions.map((r) => ({ value: r.Id, label: r.Value }));

  const mutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.tickets.setTicketStatus,
    successMessage: status?.code === "closed" ? "Complaint closed" : "Complaint resolved",
    invalidateQueries: [["tickets"], ["ticket-detail"], ["customer-detail"]],
  });

  const ready = Boolean(resolution && remarks.trim());
  const handleClose = () => { if (mutation.isPending) return; onClose?.(); };

  const submit = async () => {
    if (!ready) return;
    try {
      await mutation.mutateAsync({
        TicketId: ticket?.Id,
        StatusId: status?.value,
        ResolutionId: resolution.value,
        Remarks: remarks.trim(),
      });
      onDone?.();
      onClose?.();
    } catch {
      // useApiMutation already surfaced the server's message.
    }
  };

  const closing = status?.code === "closed";

  return (
    <Modal open={open} onClose={handleClose} size="sm" data-testid="resolve-ticket-modal">
      <Modal.Header
        title={closing ? "Close complaint" : "Resolve complaint"}
        subtitle={closing
          ? "Closing without resolving first needs the resolution the customer accepted."
          : "Say what fixed it — the customer confirms before it is closed."}
        icon={<CheckCircle size={18} />}
        onClose={handleClose}
      />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Combobox
            label="Resolution"
            required
            options={options}
            value={resolution}
            onChange={setResolution}
            placeholder="Pick a resolution"
            data-testid="resolution-combobox"
          />
          <TextArea
            label="Remarks"
            required
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={4}
            placeholder="What you did, in the customer's words if possible"
            data-testid="resolve-remarks"
          />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={mutation.isPending}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={!ready} loading={mutation.isPending} data-testid="resolve-submit">
          {closing ? "Close" : "Resolve"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
