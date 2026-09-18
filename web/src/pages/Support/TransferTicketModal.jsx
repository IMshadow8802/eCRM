// src/pages/Support/TransferTicketModal.jsx
import { useEffect, useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { enqueueSnackbar } from "notistack";

import { Modal, Button, Combobox, TextArea } from "../../components/ui";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useAssignableUsers } from "../../hooks/useAssignableUsers";
import { useLookups } from "../../hooks/useLookups";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

/**
 * Hand one complaint, or many, to someone else — always with a reason and
 * remarks (spec 2 §2). Those two are what make the assignment history readable
 * by whoever inherits the complaint, so the button stays disabled until both
 * are there; sp_TransferTicket refuses without them too.
 *
 * The branch picker is always offered: assertCanAssign is the real gate and
 * answers a Team/Self caller with a clear 403. Picking a branch reloads that
 * branch's roster and sends ToBranchId.
 */
export default function TransferTicketModal({ open, onClose, ticketIds = [], onDone }) {
  const [branch, setBranch] = useState(null);
  const [assignee, setAssignee] = useState(null);
  const [reason, setReason] = useState(null);
  const [remarks, setRemarks] = useState("");

  const bulk = ticketIds.length > 1;

  const { users } = useAssignableUsers({ branchId: branch?.value ?? null, enabled: open });
  const { lookups: reasons } = useLookups("transfer_reason", { enabled: open, showErrorMessage: false });
  const { data: branchData } = useApiQuery({
    queryKey: ["branches"],
    endpoint: SALES_ENDPOINTS.users.fetchBranches,
    enabled: open,
    showErrorMessage: false,
  });

  const assigneeOptions = users.map((u) => ({ value: u.Id, label: u.FullName }));
  const reasonOptions = reasons.map((r) => ({ value: r.Id, label: r.Value }));
  const branchOptions = (branchData?.branches ?? []).map((b) => ({ value: b.Id, label: b.BranchName }));

  // A new branch means a new roster — the old pick no longer exists in it.
  useEffect(() => setAssignee(null), [branch?.value]);

  const mutation = useApiMutation({
    endpoint: bulk ? SUPPORT_ENDPOINTS.tickets.bulkTransferTickets : SUPPORT_ENDPOINTS.tickets.transferTicket,
    // Bulk has a skip case (sp_BulkTransferTickets leaves an already-correct
    // assignment alone) that a fixed "transferred" toast would misreport, so
    // it reports its own outcome below from the resolved payload instead of
    // the mutation's own fire-and-forget success message. Single-complaint
    // has no skip case — it keeps the plain message.
    showSuccessMessage: !bulk,
    successMessage: "Complaint transferred",
    invalidateQueries: [["tickets"], ["ticket-detail"], ["customer-detail"]],
  });

  const reset = () => { setBranch(null); setAssignee(null); setReason(null); setRemarks(""); };
  const handleClose = () => { if (mutation.isPending) return; reset(); onClose?.(); };
  const ready = Boolean(assignee && reason && remarks.trim());

  // sp_BulkTransferTickets returns { Transferred, Skipped, ResponseMess } —
  // Transferred:0 means every selected complaint already sat with the target
  // (not a failure, but not a move either), so it must never read as the
  // green "it moved" toast. Prefer the server's own wording when it sent one.
  const announceBulkResult = (result) => {
    const transferred = result?.Transferred ?? 0;
    const skipped = result?.Skipped ?? 0;
    const message = result?.ResponseMess || (
      transferred === 0
        ? `Nothing moved — already with that person (${skipped} skipped)`
        : skipped > 0
          ? `${transferred} transferred, ${skipped} already with that person`
          : `${transferred} complaint(s) transferred`
    );
    enqueueSnackbar(message, { variant: transferred > 0 ? "success" : "warning" });
  };

  const submit = async () => {
    if (!ready) return;
    const common = { ToUserId: assignee.value, ToBranchId: branch?.value ?? null, ReasonId: reason.value, Remarks: remarks.trim() };
    try {
      const result = await mutation.mutateAsync(bulk ? { TicketIds: ticketIds, ...common } : { TicketId: ticketIds[0], ...common });
      if (bulk) announceBulkResult(result);
      reset();
      onDone?.();
      onClose?.();
    } catch {
      // useApiMutation already surfaced the server's message (a 403 from
      // assertCanAssign, a 400 from the SP's no-op check).
    }
  };

  return (
    <Modal open={open} onClose={handleClose} size="sm" data-testid="transfer-ticket-modal">
      <Modal.Header
        title={bulk ? `Reassign ${ticketIds.length} complaints` : "Transfer complaint"}
        icon={<ArrowRightLeft size={18} />}
        onClose={handleClose}
      />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Combobox
            label="Branch"
            options={branchOptions}
            value={branch}
            onChange={setBranch}
            placeholder="Keep current branch"
            data-testid="ticket-transfer-branch"
          />
          <Combobox
            label="New assignee"
            required
            options={assigneeOptions}
            value={assignee}
            onChange={setAssignee}
            placeholder="Who takes it over?"
            data-testid="ticket-transfer-assignee"
          />
          <Combobox
            label="Reason"
            required
            options={reasonOptions}
            value={reason}
            onChange={setReason}
            placeholder="Why is this moving?"
            data-testid="ticket-transfer-reason"
          />
          <TextArea
            label="Remarks"
            required
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="What the next person needs to know"
            data-testid="ticket-transfer-remarks"
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
          data-testid="ticket-transfer-submit"
        >
          {bulk ? "Reassign" : "Transfer"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
