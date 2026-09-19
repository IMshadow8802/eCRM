// src/pages/Sales/Quotations/quoteStatus.js
// Hoisted out of LeadQuotations.jsx (2026-09-19 review, task 17): that file
// statically imports the builder's PDF chain (LookSection -> templates ->
// @react-pdf/renderer), so a page that only needs this label/tone map — like
// the quotations list — would otherwise drag the whole PDF engine into its
// bundle for one constant. Both LeadQuotations.jsx and QuotationList.jsx
// import it from here now; neither defines its own copy.
export const QUOTE_STATUS = {
  draft: { label: "Draft", tone: "warning" }, final: { label: "Final", tone: "primary" }, accepted: { label: "Accepted", tone: "success" },
  rejected: { label: "Rejected", tone: "error" }, superseded: { label: "Superseded", tone: "default" }, unused: { label: "Not used", tone: "default" },
};
