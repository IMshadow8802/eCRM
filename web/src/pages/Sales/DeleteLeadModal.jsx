import { Trash2 } from "lucide-react";

import { Modal, Button } from "../../components/ui";
import { useApiMutation } from "../../hooks/useApiMutation";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

/**
 * Confirms + deletes a lead via sp_DeleteLead. leadController.delete reads
 * { Id } from the body (CompId injected server-side).
 */
export default function DeleteLeadModal({ open, onClose, leadId, leadName, onDeleted }) {
  const deleteMutation = useApiMutation({
    endpoint: SALES_ENDPOINTS.leads.deleteLeads,
    successMessage: "Lead deleted",
    invalidateQueries: [["leads"]],
  });

  const submit = async () => {
    try {
      await deleteMutation.mutateAsync({ Id: leadId });
      onDeleted?.();
      onClose?.();
    } catch {
      // useApiMutation already surfaced an error toast.
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="sm" data-testid="delete-lead-modal">
      <Modal.Header title="Delete Lead" icon={<Trash2 size={18} />} onClose={onClose} />
      <Modal.Body>
        <p style={{ margin: 0, fontSize: 14 }}>
          Delete {leadName ? `"${leadName}"` : "this lead"}? This action cannot be undone.
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
          data-testid="delete-submit"
        >
          Delete
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
