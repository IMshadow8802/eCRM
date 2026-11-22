// src/pages/Support/TransferTicketModal.jsx
import { useState } from "react";
import { Users } from "lucide-react";
import { enqueueSnackbar } from "notistack";

import { Modal, Button, Combobox, TextArea, Checkbox, AssigneePicker } from "../../components/ui";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useAccess } from "../../hooks/useAccess";
import { useLookups } from "../../hooks/useLookups";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

const WIDE = new Set(["Office", "OfficeTree", "Company"]);
const firstName = (name) => String(name ?? "").trim().split(/\s+/)[0];

/**
 * Reassign one complaint, or many — always with a reason and remarks, which
 * are what make the history readable by whoever inherits it. The person list
 * is the server's "Can assign to" list (AssigneePicker). Only a caller who
 * can see a whole office ("Can see" Office or wider) may leave it Unassigned
 * or move it to another office; the server decides either way.
 *
 * `onError`, when given, takes every refusal instead of the default toast
 * (the detail page uses it to leave a record that is no longer the caller's).
 */
export default function TransferTicketModal({ open, onClose, ticketIds = [], onDone, onError }) {
  const [person, setPerson] = useState(null);       // { Id, FullName }
  const [unassign, setUnassign] = useState(false);
  const [office, setOffice] = useState(null);
  const [reason, setReason] = useState(null);
  const [remarks, setRemarks] = useState("");

  const bulk = ticketIds.length > 1;
  const wide = WIDE.has(useAccess("complaints").reach);

  const { lookups: reasons } = useLookups("transfer_reason", { enabled: open, showErrorMessage: false });
  const { data: officeData } = useApiQuery({
    queryKey: ["branches"],
    endpoint: SALES_ENDPOINTS.users.fetchBranches,
    enabled: open && wide,
    showErrorMessage: false,
  });
  const reasonOptions = reasons.map((r) => ({ value: r.Id, label: r.Value }));
  const officeOptions = (officeData?.branches ?? []).map((b) => ({ value: b.Id, label: b.BranchName }));

  const mutation = useApiMutation({
    endpoint: bulk ? SUPPORT_ENDPOINTS.tickets.bulkTransferTickets : SUPPORT_ENDPOINTS.tickets.transferTicket,
    showSuccessMessage: false,   // worded below: the person's name, or the server's bulk count
    showErrorMessage: !onError,
    onError,
    invalidateQueries: [["tickets"], ["ticket-detail"], ["customer-detail"], ["logged-by-me"]],
  });

  const reset = () => { setPerson(null); setUnassign(false); setOffice(null); setReason(null); setRemarks(""); };
  const handleClose = () => { if (mutation.isPending) return; reset(); onClose?.(); };
  const ready = Boolean((person || unassign) && reason && remarks.trim());

  const submit = async () => {
    if (!ready) return;
    const common = {
      ToUserId: unassign ? null : person.Id,
      ToBranchId: office?.value ?? null,
      ReasonId: reason.value,
      Remarks: remarks.trim(),
    };
    try {
      const result = await mutation.mutateAsync(bulk ? { TicketIds: ticketIds, ...common } : { TicketId: ticketIds[0], ...common });
      const said = bulk ? result?.ResponseMess : null;
      enqueueSnackbar(said || (unassign ? "Unassigned" : `Reassigned to ${person.FullName}`), { variant: "success" });
      reset();
      onDone?.(result);
      onClose?.();
    } catch {
      // Refusal already surfaced (toast or onError); the dialog stays open.
    }
  };

  const label = unassign ? "Leave unassigned" : person ? `Reassign to ${firstName(person.FullName)}` : "Reassign";

  return (
    <Modal open={open} onClose={handleClose} size="sm" data-testid="reassign-ticket-modal">
      <Modal.Header
        title={bulk ? `Reassign ${ticketIds.length} complaints` : "Reassign complaint"}
        icon={<Users size={18} />}
        onClose={handleClose}
      />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: "calc(16rem / 15)" }}>
          <AssigneePicker
            module="complaints"
            recordId={bulk ? null : ticketIds[0] ?? null}
            enabled={open}
            label="Assigned to"
            required={!unassign}
            disabled={unassign}
            value={person?.Id ?? null}
            onChange={(id, user) => setPerson(id ? { Id: id, FullName: user?.FullName ?? "" } : null)}
            data-testid="ticket-reassign-person"
          />
          {wide && (
            <>
              <Checkbox
                label="Unassigned"
                checked={unassign}
                onChange={(e) => setUnassign(e.target.checked)}
                data-testid="ticket-reassign-unassigned"
              />
              <Combobox
                label="Move to another office"
                options={officeOptions}
                value={office}
                onChange={setOffice}
                placeholder="Stays in its office"
                data-testid="ticket-reassign-office"
              />
            </>
          )}
          <Combobox
            label="Reason"
            required
            options={reasonOptions}
            value={reason}
            onChange={setReason}
            placeholder="Why is this moving?"
            data-testid="ticket-reassign-reason"
          />
          <TextArea
            label="Remarks"
            required
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="What the next person needs to know"
            data-testid="ticket-reassign-remarks"
          />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={mutation.isPending}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={!ready} loading={mutation.isPending} data-testid="ticket-reassign-submit">
          {label}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
