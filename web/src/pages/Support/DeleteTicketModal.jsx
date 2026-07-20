import { Trash2 } from "lucide-react";

import { Modal, Button } from "../../components/ui";
import { useApiMutation } from "../../hooks/useApiMutation";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";

/**
 * Confirms + deletes a ticket via sp_DeleteTicket. ticketController.delete
 * reads { Id } from the body (CompId injected server-side). Mirrors
 * Sales/DeleteLeadModal.jsx.
 */
export default function DeleteTicketModal({ open, onClose, ticketId, ticketNo, onDeleted }) {
  const deleteMutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.tickets.deleteTicket,
    successMessage: "Ticket deleted",
    invalidateQueries: [["tickets"]],
  });

  const submit = async () => {
    try {
      await deleteMutation.mutateAsync({ Id: ticketId });
      onDeleted?.();
      onClose?.();
    } catch {
      // useApiMutation already surfaced an error toast.
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="sm" data-testid="delete-ticket-modal">
      <Modal.Header title="Delete Ticket" icon={<Trash2 size={18} />} onClose={onClose} />
      <Modal.Body>
        <p style={{ margin: 0, fontSize: 14 }}>
          Delete {ticketNo ? `"${ticketNo}"` : "this ticket"}? This action cannot be undone.
        </p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={deleteMutation.isPending}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={submit}
          loading={deleteMutation.isPending}
          data-testid="delete-ticket-submit"
        >
          Delete
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
