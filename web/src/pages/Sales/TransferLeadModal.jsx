import { useEffect, useState } from "react";
import { ArrowRightLeft } from "lucide-react";

import { Modal, Button, Combobox, TextArea } from "../../components/ui";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useAssignableUsers } from "../../hooks/useAssignableUsers";
import { useLookups } from "../../hooks/useLookups";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

/**
 * Hand one lead, or many, to someone else — always with a reason and remarks.
 * Those two are what make the assignment history readable by whoever inherits
 * the lead, so the button stays disabled until both are there. The server
 * refuses without them too; this just saves the round-trip.
 *
 * `canCrossBranch` (DataScope Branch and up) shows the branch picker; choosing
 * a branch reloads the roster for that branch and sends ToBranchId.
 */
export default function TransferLeadModal({ open, onClose, leadIds = [], onTransferred, canCrossBranch = false }) {
  const [branch, setBranch] = useState(null);
  const [owner, setOwner] = useState(null);
  const [reason, setReason] = useState(null);
  const [remarks, setRemarks] = useState("");

  const bulk = leadIds.length > 1;

  const { users } = useAssignableUsers({ branchId: branch?.value ?? null, enabled: open });
  const { lookups: reasons } = useLookups("transfer_reason", { enabled: open, showErrorMessage: false });
  const { data: branchData } = useApiQuery({
    queryKey: ["branches"],
    endpoint: SALES_ENDPOINTS.users.fetchBranches,
    enabled: open && canCrossBranch,
    showErrorMessage: false,
  });

  const ownerOptions = users.map((u) => ({ value: u.Id, label: u.FullName }));
  const reasonOptions = reasons.map((r) => ({ value: r.Id, label: r.Value }));
  const branchOptions = (branchData?.branches ?? []).map((b) => ({ value: b.Id, label: b.BranchName }));

  // A new branch means a new roster — the old pick no longer exists in it.
  useEffect(() => setOwner(null), [branch?.value]);

  const mutation = useApiMutation({
    endpoint: bulk ? SALES_ENDPOINTS.leads.bulkTransferLeads : SALES_ENDPOINTS.leads.transferLead,
    successMessage: bulk ? "Leads transferred" : "Lead transferred",
    invalidateQueries: [["leads"], ["lead-detail"], ["followups"]],
  });

  const reset = () => { setBranch(null); setOwner(null); setReason(null); setRemarks(""); };
  const handleClose = () => { reset(); onClose?.(); };
  const ready = Boolean(owner && reason && remarks.trim());

  const submit = async () => {
    if (!ready) return;
    const common = { ToUserId: owner.value, ToBranchId: branch?.value ?? null, ReasonId: reason.value, Remarks: remarks.trim() };
    try {
      await mutation.mutateAsync(bulk ? { LeadIds: leadIds, ...common } : { LeadId: leadIds[0], ...common });
      reset();
      onTransferred?.();
      onClose?.();
    } catch {
      // useApiMutation already surfaced the server's message.
    }
  };

  return (
    <Modal open={open} onClose={handleClose} size="sm" data-testid="transfer-lead-modal">
      <Modal.Header
        title={bulk ? `Transfer ${leadIds.length} leads` : "Transfer Lead"}
        icon={<ArrowRightLeft size={18} />}
        onClose={handleClose}
      />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {canCrossBranch && (
            <Combobox
              label="Branch"
              options={branchOptions}
              value={branch}
              onChange={setBranch}
              placeholder="Keep current branch"
              data-testid="transfer-branch"
            />
          )}
          <Combobox
            label="New owner"
            required
            options={ownerOptions}
            value={owner}
            onChange={setOwner}
            placeholder="Pick the new owner"
            data-testid="transfer-owner"
          />
          <Combobox
            label="Reason"
            required
            options={reasonOptions}
            value={reason}
            onChange={setReason}
            placeholder="Why is this moving?"
            data-testid="transfer-reason"
          />
          <TextArea
            label="Remarks"
            required
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="What the next person needs to know"
            data-testid="transfer-remarks"
          />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={mutation.isPending}>Cancel</Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={!ready}
          loading={mutation.isPending}
          data-testid="transfer-submit"
        >
          Transfer
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
