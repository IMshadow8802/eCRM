// src/pages/Support/RemarksModal.jsx
import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";

import { Modal, Button, TextArea } from "../../components/ui";

/**
 * One remarks prompt for every lifecycle move that needs a sentence: Reject
 * ("never solved" — the record has to say why) and Reopen (a manager's act,
 * spec 2 §2), both of which sp_SetTicketStatus refuses without remarks.
 *
 * It owns no endpoint. The caller submits, so the same prompt fronts a status
 * move, a close or an on-hold without learning three payload shapes — and the
 * caller keeps it open when the server says no.
 */
export default function RemarksModal({
  open, onClose, title, subtitle, submitLabel = "Save", required = true, onSubmit, busy = false,
}) {
  const [remarks, setRemarks] = useState("");

  // Clear on each open: the previous refusal is not a draft for the next one.
  useEffect(() => { if (open) setRemarks(""); }, [open]);

  const ready = !required || Boolean(remarks.trim());
  const handleClose = () => { if (busy) return; onClose?.(); };

  return (
    <Modal open={open} onClose={handleClose} size="sm" data-testid="remarks-modal">
      <Modal.Header title={title} subtitle={subtitle} icon={<MessageSquare size={18} />} onClose={handleClose} />
      <Modal.Body>
        <TextArea
          label="Remarks"
          required={required}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={4}
          placeholder="What happened, in a line or two"
          data-testid="remarks-input"
        />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={busy}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() => ready && onSubmit?.(remarks.trim())}
          disabled={!ready}
          loading={busy}
          data-testid="remarks-submit"
        >
          {submitLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
