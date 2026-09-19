import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@mui/material/styles";
import { FilePlus2 } from "lucide-react";
import { Button, Card, Chip, EmptyState, Modal, Skeleton } from "../../../components/ui";
import { useApiQuery } from "../../../hooks/useApiQuery";
import { useApiMutation } from "../../../hooks/useApiMutation";
import useAuthStore from "../../../stores/useAuthStore";
import { QUOTATION_ENDPOINTS } from "../../../api/quotationQueries";
import { SALES_ENDPOINTS } from "../../../api/salesQueries";
import { formatDate } from "../../../utils/format";
import { isActiveCode } from "../leadStatus";
import { money } from "./buildQuoteDoc";
import { draftBodyFromLead } from "./quoteForm";
import LookPicker from "./builder/LookSection";
import { QUOTE_STATUS } from "./quoteStatus";

/**
 * The lead page's Quotations tab. Creating one needs no form of its own: pick a
 * template, and the draft is built from what the lead and the branch's saved
 * letterhead already know (quoteForm.draftBodyFromLead), then opened in the
 * builder — already filled in.
 */
export default function LeadQuotations({ lead, onCount }) {
  const navigate = useNavigate();
  const theme = useTheme();
  const p = theme.tokens;
  const companyName = useAuthStore((s) => s.companyName);
  const [picking, setPicking] = useState(false);
  const [templateCode, setTemplateCode] = useState(null);

  const { data, isLoading } = useApiQuery({
    queryKey: ["quotations", "lead", lead.Id], endpoint: QUOTATION_ENDPOINTS.fetchQuotations,
    params: { LeadId: lead.Id, PageSize: 50 }, staleTime: 0, showErrorMessage: false,
  });
  const rows = data?.quotations ?? [];
  useEffect(() => { if (data) onCount?.(rows.length); }, [data, rows.length, onCount]);

  // Only fetched once the picker is open — a lead page that is merely being
  // read should not create a profile row for its branch.
  const { data: profileData } = useApiQuery({
    queryKey: ["quote-profile", lead.Id], endpoint: QUOTATION_ENDPOINTS.ensureQuoteProfile, params: { LeadId: lead.Id }, enabled: picking, showErrorMessage: false,
  });
  const { data: productsData } = useApiQuery({
    queryKey: ["products", "active"], endpoint: SALES_ENDPOINTS.products.fetchProducts, params: { PageSize: 200, IsActive: true }, enabled: picking, showErrorMessage: false,
  });
  const profile = profileData?.profile ?? null;
  const chosen = templateCode ?? profile?.DefaultTemplate ?? "classic";

  const create = useApiMutation({ endpoint: QUOTATION_ENDPOINTS.saveQuotation, successMessage: "Draft created", invalidateQueries: [["quotations"]] });
  const onCreate = async () => {
    const product = (productsData?.products ?? []).find((x) => x.Id === lead.ProductId) ?? null;
    try {
      const saved = await create.mutateAsync(draftBodyFromLead({ lead, profile, product, templateCode: chosen, companyName }));
      navigate(`/sales/quotations/${saved.Id}`);
    } catch { /* useApiMutation already showed the server's message */ }
  };

  if (isLoading) return <Skeleton variant="rect" height={120} />;

  return (
    <div data-testid="lead-quotations" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {isActiveCode(lead.StatusCode) && (
        <div><Button variant="primary" size="sm" leftIcon={<FilePlus2 size={14} />} onClick={() => setPicking(true)} data-testid="create-quotation-btn">Create quotation</Button></div>
      )}
      {rows.length === 0 && <EmptyState title="No quotations yet" description="A quotation is optional — small leads are often won without one." size="sm" />}
      {rows.map((q) => (
        <Card key={q.Id} interactive padding="md" onClick={() => navigate(`/sales/quotations/${q.Id}`)} data-testid={`quotation-${q.Id}`}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{q.QuoteNo || `Draft · revision ${q.Revision}`}</div>
              <div style={{ fontSize: 12, color: p.text.tertiary, marginTop: 2 }}>
                {formatDate(q.QuoteDate, { empty: "—" })}{q.ValidTill ? ` · valid till ${formatDate(q.ValidTill)}` : ""}{q.IsExpired ? " · expired" : ""}
              </div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{money(q.GrandTotal)}</div>
            <Chip size="sm" label={QUOTE_STATUS[q.Status]?.label ?? q.Status} tone={QUOTE_STATUS[q.Status]?.tone ?? "default"} />
          </div>
        </Card>
      ))}

      <Modal open={picking} onClose={() => !create.isPending && setPicking(false)} size="lg" data-testid="template-picker">
        <Modal.Header title="Pick a template" subtitle="You can change it later — nothing is lost." onClose={() => !create.isPending && setPicking(false)} />
        <Modal.Body>
          <LookPicker templateCode={chosen} accent={profile?.AccentColor || "#1e3a8a"} onTemplate={setTemplateCode} onAccent={() => {}} />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setPicking(false)} disabled={create.isPending}>Cancel</Button>
          <Button variant="primary" onClick={onCreate} loading={create.isPending} disabled={!profile}>Create</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
