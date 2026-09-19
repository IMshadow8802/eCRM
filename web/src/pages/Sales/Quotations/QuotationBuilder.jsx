import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate, useParams } from "react-router-dom";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { ArrowLeft, CircleCheck, CircleX, CopyPlus, Download, FileCheck2, Save, Trash2 } from "lucide-react";

import { Button, Card, Chip, DateField, EmptyState, Modal, PageHeader, Skeleton, TextInput } from "../../../components/ui";
import RichTextEditor from "../../../components/ui/RichTextEditor";
import RemarksModal from "../../Support/RemarksModal";
import { useApiQuery } from "../../../hooks/useApiQuery";
import { useApiMutation } from "../../../hooks/useApiMutation";
import useAuthStore from "../../../stores/useAuthStore";
import { QUOTATION_ENDPOINTS } from "../../../api/quotationQueries";
import { SALES_ENDPOINTS } from "../../../api/salesQueries";
import sampleLogo from "../../../assets/quote/sample-logo.png";
import sampleHeader from "../../../assets/quote/sample-header.png";

import { isActiveCode } from "../leadStatus";
import { amountsFromServer, buildQuoteDoc, money } from "./buildQuoteDoc";
import { amountsOf, finaliseBlockers, profileFromForm, toBody, toForm } from "./quoteForm";
import { imageIdsOf, uploadImage, useQuoteImages } from "./useQuoteImages";
import { templateByCode } from "./templates";
import { registerFonts } from "./pdf/fonts";
import { FONT_SOURCES } from "./pdf/fontSources";
import ImageSlot from "./builder/ImageSlot";
import LinesEditor from "./builder/LinesEditor";
import LookSection from "./builder/LookSection";
import { CompanySection, CustomerSection } from "./builder/PartySections";
import PdfPreview from "./builder/PdfPreview";
import SectionsEditor from "./builder/SectionsEditor";

registerFonts(FONT_SOURCES); // idempotent; this lazy chunk is the only place the PDF engine loads

const SAMPLES = { logo: sampleLogo, header: sampleHeader };
const STATUS_TONE = { draft: "warning", final: "primary", accepted: "success", rejected: "error", superseded: "default", unused: "default" };
const STATUS_TEXT = { draft: "Draft", final: "Final", accepted: "Accepted", rejected: "Rejected", superseded: "Superseded", unused: "Not used" };

function Section({ title, hint, children, action }) {
  return (
    <Card padding="md">
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 1, mb: 1.5 }}>
        <Box>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{title}</h3>
          {hint && <Box sx={{ fontSize: 12, color: "text.secondary", mt: 0.25 }}>{hint}</Box>}
        </Box>
        {action}
      </Box>
      {children}
    </Card>
  );
}

function Confirm({ open, title, body, yes, busy, onYes, onClose }) {
  return (
    <Modal open={open} onClose={() => !busy && onClose()} size="sm">
      <Modal.Header title={title} onClose={() => !busy && onClose()} />
      <Modal.Body><Box sx={{ fontSize: 14 }}>{body}</Box></Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={onYes} loading={busy}>{yes}</Button>
      </Modal.Footer>
    </Modal>
  );
}

export default function QuotationBuilder() {
  const id = Number(useParams().quotationId);
  const navigate = useNavigate();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const isAdmin = useAuthStore((s) => s.user?.IsAdmin) || false;

  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [ask, setAsk] = useState(null);          // 'finalise' | 'delete' | 'accept' | 'reject' | 'leave'
  const [uploading, setUploading] = useState(null);
  const [imageError, setImageError] = useState("");
  const pdfBlob = useRef(null);                  // a ref, not state: PdfPreview reports it during render
  // Three refs the async paths read. State would be a render behind, and
  // putting `dirty` in the reload effect's deps would re-arm it on every
  // keystroke — which is the very thing the effect must not react to.
  const dirtyRef = useRef(false);
  const editSeq = useRef(0);                     // bumped per edit; says what a save covered
  const loadedRowId = useRef(null);              // the row the form was built from

  const { data, isLoading, error, refetch } = useApiQuery({
    queryKey: ["quotation", id], endpoint: QUOTATION_ENDPOINTS.fetchQuotationDetail, params: { QuotationId: id },
    // A quotation that is not there will not be there a second later either —
    // retrying only delays the sentence that says so.
    enabled: Boolean(id), staleTime: 0, showErrorMessage: false, retry: false,
  });
  const quotation = data?.quotation ?? null;
  const leadId = quotation?.LeadId;

  const editable = quotation?.Status === "draft" && isActiveCode(quotation?.LeadStatusCode);
  const leadActive = isActiveCode(quotation?.LeadStatusCode);

  const { data: profileData, refetch: refetchProfile } = useApiQuery({
    queryKey: ["quote-profile", leadId], endpoint: QUOTATION_ENDPOINTS.ensureQuoteProfile, params: { LeadId: leadId },
    enabled: Boolean(leadId), showErrorMessage: false,
  });
  const profile = profileData?.profile ?? null;
  // The product master seeds new lines, and nothing else on this page — an
  // issued quotation never adds one, so it never asks.
  const { data: productsData } = useApiQuery({
    queryKey: ["products", "active"], endpoint: SALES_ENDPOINTS.products.fetchProducts, params: { PageSize: 200, IsActive: true },
    enabled: editable, showErrorMessage: false,
  });

  const clean = () => { dirtyRef.current = false; setDirty(false); };

  // The server's row is the form's starting point — but only when there is
  // nothing unsaved to lose. `staleTime: 0` plus refetch-on-focus means this
  // runs every time the user tabs back, and a colleague's write would then
  // delete what this one is halfway through typing. A DIFFERENT row always
  // wins (Revise routes us to the next one): there is nothing of the old one
  // worth keeping.
  useEffect(() => {
    const row = data?.quotation;
    if (!row) return;
    const rowId = row.Id ?? id;
    if (rowId === loadedRowId.current && dirtyRef.current) return;
    loadedRowId.current = rowId;
    setForm(toForm(data));
    dirtyRef.current = false;
    setDirty(false);
  }, [data, id]);

  // The browser's own guard. It is the only exit this page can intercept:
  // blocking a sidebar link needs a data router, and App.jsx does not use one.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // `patch` may be a function of the CURRENT form. Anything that writes after
  // an await must use that form — an upload takes seconds, and a plain object
  // built from the render-scope `form` would revert every field typed while it
  // was in flight.
  const update = useCallback((patch) => {
    editSeq.current += 1;
    dirtyRef.current = true;
    setForm((f) => ({ ...f, ...(typeof patch === "function" ? patch(f) : patch) }));
    setDirty(true);
  }, []);

  const ids = useMemo(() => imageIdsOf(form), [form]);
  const { images, prime } = useQuoteImages(ids);

  // A draft previews quoteMath's numbers as they type. Anything issued prints
  // the SP's stored numbers — the PDF of a final quotation never depends on
  // client arithmetic.
  // Guarded on BOTH: navigating to another revision changes the query key, so
  // `quotation` is null again for a moment while `form` still holds the row we
  // came from. Without the guard that render reads a null row and the page
  // crashes on the way to the new draft.
  const amounts = useMemo(() => (!form || !quotation ? null : editable ? amountsOf(form) : amountsFromServer(quotation, data?.lines)), [form, editable, quotation, data]);
  const doc = useMemo(() => (!form || !quotation ? null : buildQuoteDoc({
    header: { ...form.To, Status: quotation.Status, QuoteNo: quotation.QuoteNo, QuoteDate: form.QuoteDate, ValidTill: form.ValidTill, Subject: form.Subject },
    company: form.Company, content: form.Content, items: form.Lines, amounts, images, samples: SAMPLES,
  })), [form, quotation, amounts, images]);
  // The lead's status is passed in because sp_FinaliseQuotation refuses a
  // closed lead — without it the user would meet that refusal only after
  // pressing the one button that cannot be undone.
  const blockers = useMemo(
    () => (form && editable ? finaliseBlockers(form, { leadStatusCode: quotation?.LeadStatusCode }) : []),
    [form, editable, quotation],
  );

  const invalidate = [["quotation", id], ["quotations"], ["lead-detail", leadId], ["leads"]];
  // The success sentence is enqueued by doSave, which is the only place that
  // knows whether the save covered everything on screen.
  const save = useApiMutation({ endpoint: QUOTATION_ENDPOINTS.saveQuotation, showSuccessMessage: false, invalidateQueries: [["quotations"]] });
  const saveProfile = useApiMutation({ endpoint: QUOTATION_ENDPOINTS.saveQuoteProfile, successMessage: "Saved for future quotations", invalidateQueries: [["quote-profile", leadId]] });
  const rememberQuietly = useApiMutation({ endpoint: QUOTATION_ENDPOINTS.saveQuoteProfile, showSuccessMessage: false, showErrorMessage: false });
  const finalise = useApiMutation({ endpoint: QUOTATION_ENDPOINTS.finaliseQuotation, successMessage: "Quotation finalised", invalidateQueries: invalidate });
  // sp_ReviseQuotation answers either "revision started" or "a draft revision
  // already exists" — both are successes, and only one of them is what we
  // would have guessed. Its own sentence is reported instead.
  const revise = useApiMutation({ endpoint: QUOTATION_ENDPOINTS.reviseQuotation, showSuccessMessage: false, invalidateQueries: invalidate });
  const reject = useApiMutation({ endpoint: QUOTATION_ENDPOINTS.rejectQuotation, successMessage: "Marked rejected", invalidateQueries: invalidate });
  const remove = useApiMutation({ endpoint: QUOTATION_ENDPOINTS.deleteQuotation, successMessage: "Draft deleted", invalidateQueries: invalidate });
  const accept = useApiMutation({ endpoint: QUOTATION_ENDPOINTS.convertLead, successMessage: "Accepted — the lead is won", invalidateQueries: invalidate });

  const doSave = async () => {
    const sent = editSeq.current;   // every edit up to this line is in the payload
    await save.mutateAsync(toBody(form, { id, leadId }));
    // "The template remembers": the first fill of a branch's letterhead is saved
    // for everyone after, unasked. Once set, only an admin changes it — and only
    // by pressing the button that says so.
    if (profile && !profile.IsSet && form.Company.name.trim()) {
      await rememberQuietly.mutateAsync(profileFromForm(form, leadId)).then(() => refetchProfile()).catch(() => {});
    }
    // Anything typed while the save was in flight is NOT in what the server
    // now holds. Staying dirty is what stops the refetch below overwriting it,
    // and what keeps Save offered for the part that is still unsaved — but an
    // enabled Save button beside a flat "Quotation saved" reads as a stuck
    // button, not as a warning, so the sentence says which one happened.
    const settled = editSeq.current === sent;
    if (settled) clean();
    enqueueSnackbar(settled ? "Quotation saved" : "Saved — you've typed more since", { variant: settled ? "success" : "info" });
    await refetch();
  };

  const run = (fn) => async (...args) => { try { await fn(...args); } catch { /* useApiMutation already showed the server's message */ } };

  const onFinalise = run(async () => { if (dirty) await doSave(); await finalise.mutateAsync({ QuotationId: id }); setAsk(null); await refetch(); });
  const onDelete = run(async () => { await remove.mutateAsync({ QuotationId: id }); navigate(`/sales/leads/${leadId}`); });
  const onAccept = run(async () => { await accept.mutateAsync({ LeadId: leadId, QuotationId: id }); setAsk(null); await refetch(); });
  const onReject = run(async (remarks) => { await reject.mutateAsync({ QuotationId: id, Remarks: remarks || null }); setAsk(null); await refetch(); });
  const onRevise = run(async () => {
    const res = await revise.mutateAsync({ QuotationId: id });
    enqueueSnackbar(res.ResponseMess || "Revision started", { variant: "success" });
    queryClient.removeQueries({ queryKey: ["quotation", res.Id] });
    navigate(`/sales/quotations/${res.Id}`);
  });
  const goToLead = () => navigate(`/sales/leads/${leadId}`);

  const onDownload = () => {
    // Before the first render finishes there is no file yet. Saying so beats a
    // button that looks like it worked and did nothing.
    if (!pdfBlob.current) { enqueueSnackbar("The preview is still drawing — try again in a moment", { variant: "info" }); return; }
    const url = URL.createObjectURL(pdfBlob.current);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${quotation.QuoteNo || "Quotation"} - ${form.To.ToName || "customer"}.pdf`.replace(/[\\/:*?"<>|]/g, "-");
    document.body.appendChild(a); a.click(); a.remove();
    // Revoking in the same tick is fine in Chrome and has historically raced
    // the download in Firefox and Safari. One tick costs nothing.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  // Letterhead pictures hang off the branch PROFILE (company-wide readable,
  // never deleted — issued quotations keep drawing them). A section's pictures
  // hang off THIS quotation. The two are not interchangeable, so neither
  // upload guesses when its owner is missing.
  const uploadLetterhead = (slot) => async (file) => {
    setUploading(slot); setImageError("");
    try {
      if (!profile?.Id) throw new Error("The branch letterhead is still loading — try again in a moment");
      const { id: attachmentId, dataUrl } = await uploadImage({ entity: "quoteprofile", entityId: profile.Id, file });
      prime(attachmentId, dataUrl);
      update((f) => ({ Company: { ...f.Company, [`${slot}AttachmentId`]: attachmentId, [slot === "logo" ? "showLogo" : "showHeader"]: true } }));
    } catch (err) { setImageError(err.message); } finally { setUploading(null); }
  };
  const uploadPicture = async (file) => {
    // A picture belongs to THIS quotation, so there has to be one to belong to.
    if (!id) throw new Error("Save the quotation before adding pictures to it");
    const { id: attachmentId, dataUrl } = await uploadImage({ entity: "quotation", entityId: id, file });
    prime(attachmentId, dataUrl);
    return { id: attachmentId };
  };

  if (error) {
    // Only a 404 licenses the sentence about deletion and permission. A
    // dropped connection or a 500 is not evidence the quotation is gone.
    const missing = error.response?.status === 404;
    return (
      <EmptyState size="md"
        title={missing ? "Quotation not found" : "This quotation could not be loaded"}
        description={missing
          ? "It may have been deleted, or it belongs to a lead you cannot see."
          : "The server could not be reached, or answered with an error. Nothing has been changed."}
        action={missing ? undefined : <Button variant="tonal" onClick={() => refetch()}>Try again</Button>}
      />
    );
  }
  if (isLoading || !form || !doc) return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }} data-testid="quotation-loading">
      <Skeleton variant="text" height={28} width={260} /><Skeleton variant="rect" height={420} />
    </Box>
  );

  const c = form.Company;
  // Both take the current form, so two edits landing in one tick cannot drop
  // each other. `setCompany` still accepts a whole block, which is what
  // CompanySection hands back.
  const setCompany = (patch) => update((f) => ({ Company: typeof patch === "function" ? patch(f.Company) : patch }));
  const setContent = (k) => (v) => update((f) => ({ Content: { ...f.Content, [k]: v } }));
  const title = quotation.QuoteNo || `Draft quotation${quotation.Revision > 1 ? ` · revision ${quotation.Revision}` : ""}`;

  return (
    <Box data-testid="quotation-builder" sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <Helmet><title>PRD Infotech | {title}</title></Helmet>
      <PageHeader
        title={title}
        subtitle={`For ${quotation.LeadName}${quotation.LeadCompany ? ` · ${quotation.LeadCompany}` : ""}`}
        titleSuffix={<Chip label={STATUS_TEXT[quotation.Status] ?? quotation.Status} tone={STATUS_TONE[quotation.Status] ?? "default"} size="sm" data-testid="quote-status-chip" />}
        actions={
          <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
            {/* Not PageHeader's breadcrumb: it renders plain <a href>, which is a full
                page load and ignores the router's /prdcrm/ basename. */}
            <Button variant="text" size="sm" leftIcon={<ArrowLeft size={14} />} onClick={() => (dirty ? setAsk("leave") : goToLead())}>Back to lead</Button>
            {/* Download is not a final-only action. On a phone the preview
                iframe below may render nothing at all (Chrome on Android has
                no inline PDF viewer), so on a draft this is the only way to
                see the document being built. */}
            {editable && <Button variant="tonal" size="sm" leftIcon={<Download size={14} />} onClick={onDownload}>Download PDF</Button>}
            {editable ? (
              <>
                <Button variant="ghost" size="sm" leftIcon={<Trash2 size={14} />} onClick={() => setAsk("delete")}>Delete draft</Button>
                <Button variant="tonal" size="sm" leftIcon={<Save size={14} />} onClick={run(doSave)} disabled={!dirty} loading={save.isPending}>Save</Button>
                <Button variant="primary" size="sm" leftIcon={<FileCheck2 size={14} />} onClick={() => setAsk("finalise")} disabled={blockers.length > 0}>Finalise</Button>
              </>
            ) : (
              <>
                <Button variant="tonal" size="sm" leftIcon={<Download size={14} />} onClick={onDownload}>Download PDF</Button>
                {leadActive && ["final", "rejected", "unused"].includes(quotation.Status) && (
                  <Button variant="tonal" size="sm" leftIcon={<CopyPlus size={14} />} onClick={onRevise} loading={revise.isPending}>Revise</Button>
                )}
                {quotation.Status === "final" && leadActive && (
                  <>
                    <Button variant="ghost" size="sm" leftIcon={<CircleX size={14} />} onClick={() => setAsk("reject")}>Rejected</Button>
                    <Button variant="primary" size="sm" leftIcon={<CircleCheck size={14} />} onClick={() => setAsk("accept")}>Accepted</Button>
                  </>
                )}
              </>
            )}
          </Box>
        }
      />

      {editable && blockers.length > 0 && (
        <Box data-testid="finalise-blockers" sx={{ mt: 1, fontSize: 13, color: theme.tokens.warning.hover }}>
          Before you can finalise: {blockers.join(" · ")}
        </Box>
      )}
      {!editable && quotation.CloseRemarks && <Box sx={{ mt: 1, fontSize: 13, color: "text.secondary" }}>{quotation.CloseRemarks}</Box>}

      <Box sx={{ mt: 2, display: "grid", gap: 2, alignItems: "start", gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 560px) minmax(0, 1fr)" } }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Section title="Look">
            <LookSection templateCode={form.TemplateCode} accent={c.accent} disabled={!editable}
              onTemplate={(TemplateCode) => update({ TemplateCode })} onAccent={(accent) => setCompany((co) => ({ ...co, accent }))} />
          </Section>

          <Section title="Your company" hint="Filled in once per branch — it is remembered for the next quotation."
            action={editable && isAdmin && profile?.IsSet ? (
              <Button size="sm" variant="ghost" loading={saveProfile.isPending} onClick={run(async () => { await saveProfile.mutateAsync(profileFromForm(form, leadId)); })}>Save as our default</Button>
            ) : null}>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "112px minmax(0, 1fr)" }, gap: 2, mb: 2 }}>
              <ImageSlot label="Logo" data-testid="logo-slot" src={doc.logoSrc} isSample={!c.logoAttachmentId} hidden={c.showLogo === false} disabled={!editable} busy={uploading === "logo"}
                onUpload={uploadLetterhead("logo")} onRemove={() => setCompany((co) => ({ ...co, showLogo: false }))} onRestore={() => setCompany((co) => ({ ...co, showLogo: true }))} />
              <ImageSlot label="Banner" wide data-testid="header-slot" src={doc.headerSrc} isSample={!c.headerAttachmentId} hidden={c.showHeader === false} disabled={!editable} busy={uploading === "header"}
                onUpload={uploadLetterhead("header")} onRemove={() => setCompany((co) => ({ ...co, showHeader: false }))} onRestore={() => setCompany((co) => ({ ...co, showHeader: true }))} />
            </Box>
            {imageError && <Box role="alert" sx={{ fontSize: 12, color: theme.tokens.error.main, mb: 1 }}>{imageError}</Box>}
            <CompanySection value={c} disabled={!editable} onChange={setCompany} />
          </Section>

          <Section title="Customer">
            <CustomerSection value={form.To} taxed={Boolean(amounts?.taxed)} disabled={!editable} onChange={(To) => update({ To })} />
          </Section>

          <Section title="Details">
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
              <DateField label="Quotation date" value={form.QuoteDate} onChange={(QuoteDate) => update({ QuoteDate })} disabled={!editable} />
              <DateField label="Valid till" value={form.ValidTill} onChange={(ValidTill) => update({ ValidTill })} disabled={!editable} minDate={form.QuoteDate || undefined} />
              <Box sx={{ gridColumn: "1 / -1" }}><TextInput label="Subject" value={form.Subject} onChange={(e) => update({ Subject: e.target.value })} disabled={!editable} /></Box>
            </Box>
          </Section>

          <Section title="Lines" hint={`Grand total ${money(amounts?.grandTotal)}`}>
            <LinesEditor lines={form.Lines} amounts={amounts} products={productsData?.products ?? []} disabled={!editable} onChange={(Lines) => update({ Lines })} />
          </Section>

          <Section title="Message, notes & terms">
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <RichTextEditor label="Opening message" hint="Printed above the price table" value={form.Content.intro} onChange={setContent("intro")} disabled={!editable} data-testid="rte-intro" />
              <RichTextEditor label="Notes" hint="Printed under the totals" value={form.Content.notes} onChange={setContent("notes")} disabled={!editable} minHeight={90} data-testid="rte-notes" />
              <RichTextEditor label="Terms & conditions" value={form.Content.terms} onChange={setContent("terms")} disabled={!editable} data-testid="rte-terms" />
            </Box>
          </Section>

          <Section title="Extra sections" hint="Appended after the notes: a scope table, product pictures, an introduction to your company.">
            <SectionsEditor sections={form.Content.sections} images={images} disabled={!editable} onChange={setContent("sections")} onUploadPicture={uploadPicture} />
          </Section>
        </Box>

        <Box sx={{ position: { lg: "sticky" }, top: 84, height: { xs: 560, lg: "calc(100dvh - 210px)" } }}>
          <PdfPreview Component={templateByCode(form.TemplateCode).Component} doc={doc} onReady={(blob) => { pdfBlob.current = blob; }} />
        </Box>
      </Box>

      <Confirm open={ask === "finalise"} title="Finalise this quotation?" yes="Yes, finalise" busy={finalise.isPending || save.isPending} onYes={onFinalise} onClose={() => setAsk(null)}
        body="It gets its number and is locked. To change it afterwards you revise it — the customer's copy never changes silently." />
      <Confirm open={ask === "delete"} title="Delete this draft?" yes="Yes, delete" busy={remove.isPending} onYes={onDelete} onClose={() => setAsk(null)}
        body="The draft and any pictures uploaded to it are removed. This cannot be undone." />
      <Confirm open={ask === "accept"} title="The customer accepted?" yes="Yes, they accepted" busy={accept.isPending} onYes={onAccept} onClose={() => setAsk(null)}
        body={`The lead is marked won for ${money(quotation.TaxableTotal)} (before tax), and ${form.To.ToName} becomes a customer. Any other open quotation on this lead is closed.`} />
      <Confirm open={ask === "leave"} title="Leave without saving?" yes="Leave anyway" busy={false} onYes={goToLead} onClose={() => setAsk(null)}
        body="This draft has changes that have not been saved. Leaving now discards them." />
      <RemarksModal open={ask === "reject"} onClose={() => setAsk(null)} title="The customer said no" subtitle="Optional — why? It helps the next quotation."
        submitLabel="Mark rejected" required={false} busy={reject.isPending} onSubmit={onReject} />
    </Box>
  );
}
