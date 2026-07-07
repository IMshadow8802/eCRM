import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";

import { Modal, Button, Combobox } from "../../components/ui";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useUsers } from "../../hooks";
import { getUserName } from "../../utils/userShape";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

/**
 * Reassigns a lead to a new owner via sp_TransferLead. leadController.transfer
 * reads { LeadId, OwnerId } from the body (CompId/UserId injected server-side).
 */
export default function TransferLeadModal({ open, onClose, leadId, onTransferred }) {
  const [owner, setOwner] = useState(null);

  const { data: usersData } = useUsers({ PageSize: 1000 });
  const ownerOptions = (usersData?.users || []).map((u) => ({
    value: u.Id,
    label: getUserName(u) || u.Username,
  }));

  const transferMutation = useApiMutation({
    endpoint: SALES_ENDPOINTS.leads.transferLead,
    successMessage: "Lead transferred",
    invalidateQueries: [["leads"]],
  });

  const handleClose = () => {
    setOwner(null);
    onClose?.();
  };

  const submit = async () => {
    if (!owner) return;
    try {
      await transferMutation.mutateAsync({ LeadId: leadId, OwnerId: owner.value });
      setOwner(null);
      onTransferred?.();
      onClose?.();
    } catch {
      // useApiMutation already surfaced an error toast.
    }
  };

  return (
    <Modal open={open} onClose={handleClose} size="sm" data-testid="transfer-lead-modal">
      <Modal.Header
        title="Transfer Lead"
        icon={<ArrowRightLeft size={18} />}
        onClose={handleClose}
      />
      <Modal.Body>
        <Combobox
          label="New owner"
          required
          options={ownerOptions}
          value={owner}
          onChange={setOwner}
          placeholder="Pick the new owner"
          data-testid="transfer-owner"
        />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={transferMutation.isPending}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={!owner}
          loading={transferMutation.isPending}
          data-testid="transfer-submit"
        >
          Transfer
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
