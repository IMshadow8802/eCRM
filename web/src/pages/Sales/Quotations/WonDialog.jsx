import { useEffect, useState } from "react";
import { useTheme } from "@mui/material/styles";
import { Trophy } from "lucide-react";
import { Button, Modal, TextArea, TextInput } from "../../../components/ui";
import { useApiQuery } from "../../../hooks/useApiQuery";
import { useApiMutation } from "../../../hooks/useApiMutation";
import { QUOTATION_ENDPOINTS } from "../../../api/quotationQueries";
import { money } from "./buildQuoteDoc";

/**
 * Marking a lead won. ONE engine writes a win (sp_ConvertLead); this is its
 * manual door — "Accepted" on a quotation is the other.
 *
 * A quotation is optional: small leads are won with none, on a typed value. But
 * if the lead HAS finalised quotations, the agent is asked which one the
 * customer accepted (or "none"), so a win is never recorded at a guessed value
 * while the real one is sitting in a quotation on the same lead.
 */
export default function WonDialog({ open, lead, onClose, onWon }) {
  const theme = useTheme();
  const p = theme.tokens;
  const [choice, setChoice] = useState(null);   // a quotation Id, "none", or null = not chosen yet
  const [value, setValue] = useState("");
  const [remarks, setRemarks] = useState("");

  const { data, isLoading } = useApiQuery({
    queryKey: ["quotations", "final", lead?.Id], endpoint: QUOTATION_ENDPOINTS.fetchQuotations,
    params: { LeadId: lead?.Id, Status: "final", PageSize: 50 }, enabled: open && Boolean(lead?.Id), staleTime: 0, showErrorMessage: false,
  });
  const finals = data?.quotations ?? [];

  useEffect(() => {
    if (!open) return;
    setChoice(null); setRemarks("");
    setValue(lead?.EstValue == null ? "" : String(lead.EstValue));
  }, [open, lead]);

  const convert = useApiMutation({
    endpoint: QUOTATION_ENDPOINTS.convertLead, successMessage: "Lead marked won",
    invalidateQueries: [["lead-detail", lead?.Id], ["leads"], ["quotations"], ["customers"]],
  });

  const needsChoice = finals.length > 0;
  const typed = !needsChoice || choice === "none";
  const amount = value === "" ? null : Number(value);
  const ready = !isLoading && (typed ? amount !== null && Number.isFinite(amount) && amount >= 0 : choice !== null);

  const submit = async () => {
    try {
      await convert.mutateAsync({
        LeadId: lead.Id, WonValue: typed ? amount : null, Remarks: remarks.trim() || null, QuotationId: typed ? null : choice,
      });
      onWon?.();
      onClose?.();
    } catch { /* useApiMutation already showed the server's message */ }
  };

  const option = (id, labelText, detail) => (
    <label key={id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: theme.radii.sm, cursor: "pointer",
      border: `1px solid ${choice === id ? p.primary.main : p.border.default}`, background: choice === id ? p.primary.subtle : p.surface.card }}>
      <input type="radio" name="won-quotation" checked={choice === id} onChange={() => setChoice(id)} aria-label={labelText} />
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{labelText}</span>
      {detail && <span style={{ fontSize: 13, color: p.text.secondary }}>{detail}</span>}
    </label>
  );

  return (
    <Modal open={open} onClose={() => !convert.isPending && onClose?.()} size="md" data-testid="won-dialog">
      <Modal.Header title="Mark this lead won" subtitle={lead?.Name} icon={<Trophy size={18} />} onClose={() => !convert.isPending && onClose?.()} />
      <Modal.Body>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {needsChoice && (
            <div role="radiogroup" aria-label="Which quotation did they accept?" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: p.text.secondary }}>Which quotation did they accept?</span>
              {finals.map((q) => option(q.Id, q.QuoteNo, money(q.TaxableTotal)))}
              {option("none", "None — won without a quotation")}
            </div>
          )}
          {typed && (needsChoice ? choice === "none" : true) && (
            <TextInput label="Won for (₹, before tax)" required inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} data-testid="won-value" />
          )}
          <TextArea label="Remarks" rows={2} placeholder="Optional — e.g. paid by UPI" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={convert.isPending}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={!ready} loading={convert.isPending} data-testid="won-submit">Mark won</Button>
      </Modal.Footer>
    </Modal>
  );
}
