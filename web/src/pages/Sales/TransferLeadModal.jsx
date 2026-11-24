import { useState } from "react";
import { Undo2, UserRoundPen } from "lucide-react";
import { enqueueSnackbar } from "notistack";

import { Modal, Button, Combobox, TextArea, Checkbox, AssigneePicker } from "../../components/ui";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useLookups } from "../../hooks/useLookups";
import { useAccess } from "../../hooks/useAccess";
import { SALES_ENDPOINTS } from "../../api/salesQueries";

const firstName = (name = "") => name.trim().split(/\s+/)[0];

/**
 * Reassign one lead, or many — always with a reason and remarks, which make the
 * assignment history readable by whoever inherits it. With `sendBackTo`
 * ({ id, name } from the detail's SendBackToId/Name) it is instead the
 * remarks-only "Send back" dialog. The server (sp_TransferLead gates) decides;
 * a refusal keeps the dialog open with its message and calls `onFailed` so the
 * caller can refetch. `onDone(result)` gets the server row (ToName, Moved, ...).
 *
 * `onError`, when given, takes the refusal instead of the default toast (the
 * detail page uses it to leave a lead that answered 404).
 *
 * Office reach and wider also get "Unassigned" and "Move to another office".
 */
export default function TransferLeadModal({ open, onClose, leadIds = [], sendBackTo = null, onDone, onFailed, onError }) {
  const [person, setPerson] = useState(null);       // { id, name }
  const [unassigned, setUnassigned] = useState(false);
  const [office, setOffice] = useState(null);
  const [reason, setReason] = useState(null);
  const [remarks, setRemarks] = useState("");

  const bulk = leadIds.length > 1;
  const sendBack = Boolean(sendBackTo) && !bulk;
  const wide = useAccess("leads").wide;

  const { lookups: reasons } = useLookups("transfer_reason", { enabled: open && !sendBack, showErrorMessage: false });
  const { data: officeData } = useApiQuery({
    queryKey: ["branches"],
    endpoint: SALES_ENDPOINTS.users.fetchBranches,
    enabled: open && wide && !sendBack,
    showErrorMessage: false,
  });
  // "Sent back" is written only by the Send back action; picked by hand it would hide
  // the giver from the next person's Send back (fn_RecordGiver skips it). 143 refuses it too.
  const reasonOptions = reasons
    .filter((r) => r.Code !== "sent_back")
    .map((r) => ({ value: r.Id, label: r.Value }));
  const officeOptions = (officeData?.branches ?? []).map((b) => ({ value: b.Id, label: b.BranchName }));

  const mutation = useApiMutation({
    endpoint: bulk ? SALES_ENDPOINTS.leads.bulkTransferLeads : SALES_ENDPOINTS.leads.transferLead,
    showSuccessMessage: false, // the message names the person, built below from the answer
    showErrorMessage: !onError,
    onError,
    invalidateQueries: [["leads"], ["lead-detail"], ["followups"]],
  });

  const reset = () => { setPerson(null); setUnassigned(false); setOffice(null); setReason(null); setRemarks(""); };
  const handleClose = () => { if (mutation.isPending) return; reset(); onClose?.(); };
  const ready = sendBack
    ? Boolean(remarks.trim())
    : Boolean((person || unassigned) && reason && remarks.trim());

  const submit = async () => {
    if (!ready) return;
    const body = sendBack
      ? { LeadId: leadIds[0], SendBack: true, Remarks: remarks.trim() }
      : {
          ...(bulk ? { LeadIds: leadIds } : { LeadId: leadIds[0] }),
          ToUserId: unassigned ? null : person.id,
          ToBranchId: office?.value ?? null,
          ReasonId: reason.value,
          Remarks: remarks.trim(),
        };
    try {
      const result = await mutation.mutateAsync(body);
      const name = result?.ToName ?? (sendBack ? sendBackTo.name : person?.name);
      const message = bulk
        ? result?.ResponseMess || `${leadIds.length} leads reassigned`
        : sendBack ? `Sent back to ${name}` : unassigned ? "Unassigned" : `Reassigned to ${name}`;
      enqueueSnackbar(message, { variant: "success" });
      reset();
      onDone?.(result);
      onClose?.();
    } catch {
      // useApiMutation showed the server's sentence; the caller refetches.
      onFailed?.();
    }
  };

  const title = sendBack
    ? `Send back to ${sendBackTo.name}`
    : bulk ? `Reassign ${leadIds.length} leads` : "Reassign lead";
  const submitLabel = sendBack
    ? `Send back to ${firstName(sendBackTo.name)}`
    : unassigned ? "Leave unassigned" : person ? `Reassign to ${firstName(person.name)}` : "Reassign";

  return (
    <Modal open={open} onClose={handleClose} size="sm" data-testid="reassign-lead-modal">
      <Modal.Header title={title} icon={sendBack ? <Undo2 size={18} /> : <UserRoundPen size={18} />} onClose={handleClose} />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: "calc(16rem / 15)" }}>
          {!sendBack && (
            <>
              <AssigneePicker
                module="leads"
                recordId={bulk ? null : leadIds[0] ?? null}
                enabled={open}
                label="Assigned to"
                required={!unassigned}
                disabled={unassigned}
                value={person?.id ?? null}
                onChange={(id, u) => setPerson(id ? { id, name: u?.FullName ?? "" } : null)}
                placeholder="Pick a person"
                data-testid="reassign-person"
              />
              {wide && (
                <>
                  <Checkbox
                    label="Unassigned"
                    checked={unassigned}
                    onChange={(e) => { setUnassigned(e.target.checked); setPerson(null); }}
                    data-testid="reassign-unassigned"
                  />
                  <Combobox
                    label="Move to another office"
                    options={officeOptions}
                    value={office}
                    onChange={setOffice}
                    placeholder="Stays in its office"
                    data-testid="reassign-office"
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
                data-testid="reassign-reason"
              />
            </>
          )}
          <TextArea
            label="Remarks"
            required
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="What the next person needs to know"
            data-testid="reassign-remarks"
          />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={mutation.isPending}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={!ready} loading={mutation.isPending} data-testid="reassign-submit">
          {submitLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
