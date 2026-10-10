import { useEffect, useState } from "react";
import { useTheme } from "@mui/material/styles";
import { Banknote } from "lucide-react";

import { Modal, Button, TextInput, DateField } from "../../../components/ui";
import FormGrid from "../../../components/ui/FormGrid";
import { useApiMutation } from "../../../hooks/useApiMutation";
import { PARTNER_ENDPOINTS } from "../../../api/partnerQueries";
import { formatCurrency } from "../../../utils/format";

// Local calendar day — toISOString() is UTC and rolls the date back for IST mornings.
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Records that the selected "ready to pay" commissions were paid. `ids` = commission ids, `total` = their sum. */
export default function MarkPaidModal({ open, onClose, ids = [], total = 0, onDone }) {
  const errorColor = useTheme().tokens.error.main;
  const [paidOn, setPaidOn] = useState(localToday);
  const [ref, setRef] = useState("");
  const [serverError, setServerError] = useState("");

  useEffect(() => {
    if (open) { setPaidOn(localToday()); setRef(""); setServerError(""); }
  }, [open]);

  const pay = useApiMutation({
    endpoint: PARTNER_ENDPOINTS.setCommissionStatus,
    successMessage: "Marked as paid",
    invalidateQueries: [["commissions"], ["partners"]],
    showErrorMessage: false,
  });

  const submit = async () => {
    setServerError("");
    if (!paidOn) { setServerError("Choose the date it was paid"); return; }
    try {
      await pay.mutateAsync({ Ids: ids, ToStatus: "paid", PaidAt: paidOn, PaidRef: ref.trim() || null });
      onDone?.();
      onClose?.();
    } catch (e) {
      setServerError(e.response?.data?.message || e.message || "Could not mark as paid");
    }
  };

  const close = () => { if (!pay.isPending) onClose?.(); };

  return (
    <Modal open={open} onClose={close} size="sm" data-testid="mark-paid-modal">
      <Modal.Header title="Mark paid" subtitle={`${ids.length} commission${ids.length === 1 ? "" : "s"}, ${formatCurrency(total)} in all`} icon={<Banknote size={18} />} onClose={close} />
      <Modal.Body>
        <FormGrid>
          <DateField label="Paid on" value={paidOn} onChange={setPaidOn} data-testid="paid-on" required />
          <TextInput label="Reference (UTR / cheque no.)" value={ref} onChange={(e) => setRef(e.target.value)} data-testid="paid-ref" />
        </FormGrid>
        {serverError && <div role="alert" style={{ color: errorColor, marginTop: "calc(12rem / 15)", fontSize: "calc(13rem / 15)" }}>{serverError}</div>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={close} disabled={pay.isPending}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={pay.isPending} data-testid="mark-paid-submit">Mark paid</Button>
      </Modal.Footer>
    </Modal>
  );
}
