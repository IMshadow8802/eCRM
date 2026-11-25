// src/pages/Sales/CallingLists/ListFormModal.jsx — New list / Add contacts (spec 13.2).
// Three steps in one modal: Details → Sheet → Callers (Callers only with calling edit). Lazy-loaded by its pages,
// so sheetParse (and read-excel-file behind it) stays out of every other bundle.
// Server sentences are shown in the step that caused them, never only a snackbar.
import { useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useQueryClient } from "@tanstack/react-query";
import { Check, CloudUpload, Download, FileSpreadsheet } from "lucide-react";

import { Button, Chip, Combobox, DateField, Modal, Switch, TextArea, TextInput } from "../../../components/ui";
import FormGrid, { FormGridSpan } from "../../../components/ui/FormGrid";
import { useApiQuery } from "../../../hooks/useApiQuery";
import { useAssignableUsers } from "../../../hooks/useAssignableUsers";
import { useAccess, useIsAdmin } from "../../../hooks/useAccess";
import { CALLING_ENDPOINTS, call, listBody } from "../../../api/callingQueries";
import { SALES_ENDPOINTS } from "../../../api/salesQueries";
import { toCsv } from "../../Reports/reportUtils";
import { buildRows, chunks, guessMapping, MAX_ROWS, readSheet, TARGETS } from "./sheetParse";

const STEPS = [["details", "Details"], ["sheet", "Sheet"], ["callers", "Callers"]];
const COUNT_LABELS = [["Added", "Will be added"], ["InPool", "Already in pool"], ["IsLead", "Already a lead"],
  ["IsCustomer", "Already a customer"], ["Dnc", "Do not call"], ["BadNumber", "Bad number"], ["Repeated", "Repeated in sheet"]];
const ZERO = Object.fromEntries(COUNT_LABELS.map(([k]) => [k, 0]));
const GROUPS = { 1: "Your manager and team", 2: "Your office", 3: "Other offices" };
const PREVIEW_ROWS = 10;
// RowNo counts data rows from 1; the user sees the sheet's own row number (the header is row 1).
const sheetRow = (rowNo) => rowNo + 1;

/** The original sheet rows that were skipped, plus a Reason column — to argue with the vendor. */
export function skippedCsv(headers, rows, skipped) {
  const columns = [...headers.map((h, i) => ({ key: `c${i}`, header: h })), { key: "Reason", header: "Reason" }];
  const out = [...skipped].sort((a, b) => a.RowNo - b.RowNo).map((s) => ({
    ...Object.fromEntries(headers.map((_, i) => [`c${i}`, rows[s.RowNo - 1]?.[i] ?? ""])), Reason: s.Reason,
  }));
  return toCsv(columns, out);
}

const schema = (admin) => z.object({
  Name: z.string().trim().min(1, "Name is required").max(200, "At most 200 characters"),
  BranchId: z.number({ error: "Pick the office" }).nullable().refine((v) => v != null, "Pick the office"),
  Vendor: z.string().optional(),
  PurchasedOn: z.string().nullable().optional(),
  Cost: z.string().optional().refine((v) => !admin || !v || (Number.isFinite(Number(v)) && Number(v) >= 0), "Cost must be 0 or more"),
  ProductId: z.number().nullable().optional(),
  Script: z.string().optional(),
});

// Without calling edit the Callers step is left out: handing out is an edit (spec 3a).
function Steps({ step }) {
  const p = useTheme().tokens;
  const steps = useAccess("calling").edit ? STEPS : STEPS.slice(0, 2);
  const at = steps.findIndex(([k]) => k === step);
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }} data-testid="list-steps">
      {steps.map(([k, label], i) => (
        <Box key={k} sx={{ display: "flex", alignItems: "center", gap: 1, flex: i < steps.length - 1 ? 1 : "none" }}>
          <Box aria-current={i === at ? "step" : undefined} sx={{ display: "flex", alignItems: "center", gap: 0.75, fontSize: "calc(13rem / 15)", fontWeight: 600, color: i <= at ? p.text.primary : p.text.tertiary }}>
            <Box sx={{ width: "calc(22rem / 15)", height: "calc(22rem / 15)", borderRadius: "50%", display: "grid", placeItems: "center", fontSize: "calc(12rem / 15)",
              background: i < at ? p.success.main : i === at ? p.primary.main : p.surface.track, color: i <= at ? p.primary.contrastText : p.text.secondary }}>
              {i < at ? <Check size={12} /> : i + 1}
            </Box>
            {label}
          </Box>
          {i < steps.length - 1 && <Box sx={{ flex: 1, height: "1px", background: p.border.default }} />}
        </Box>
      ))}
    </Box>
  );
}

function Note({ tone = "info", children, testId }) {
  const p = useTheme().tokens;
  const t = p[tone] ?? p.info;
  return (
    <Box role={tone === "error" ? "alert" : "status"} data-testid={testId}
      sx={{ background: t.subtle, border: `1px solid ${t.border}`, color: p.text.primary, borderRadius: "calc(8rem / 15)", p: "calc(10rem / 15) calc(12rem / 15)", fontSize: "calc(13rem / 15)", mt: 1.5 }}>
      {children}
    </Box>
  );
}

function DetailsStep({ saved, onSaved, onCancel }) {
  const admin = useIsAdmin();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: branchData } = useApiQuery({ queryKey: ["branches"], endpoint: SALES_ENDPOINTS.users.fetchBranches, showErrorMessage: false });
  const { data: productData } = useApiQuery({ queryKey: ["products", "active"], endpoint: SALES_ENDPOINTS.products.fetchProducts, params: { PageSize: 200, IsActive: true }, showErrorMessage: false });
  // tblBranch.Id is BIGINT, which arrives as a string; the schema wants a number.
  const branches = useMemo(() => (branchData?.branches ?? []).map((b) => ({ value: Number(b.Id), label: b.BranchName })), [branchData]);
  const products = useMemo(() => (productData?.products ?? []).map((x) => ({ value: x.Id, label: x.Name })), [productData]);
  const { control, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(schema(admin)),
    defaultValues: {
      Name: saved?.Name ?? "", BranchId: saved?.BranchId ?? null, Vendor: saved?.Vendor ?? "", PurchasedOn: saved?.PurchasedOn ?? null,
      Cost: saved?.Cost == null ? "" : String(saved.Cost), ProductId: saved?.ProductId ?? null, Script: saved?.Script ?? "",
    },
  });

  const submit = async (v) => {
    setBusy(true); setError("");
    const body = listBody(saved, {
      Id: saved?.Id ?? 0, BranchId: v.BranchId, Name: v.Name.trim(), Vendor: v.Vendor?.trim() || null, PurchasedOn: v.PurchasedOn || null,
      Cost: admin ? (v.Cost ? Number(v.Cost) : null) : (saved?.Cost ?? null), ProductId: v.ProductId ?? null, Script: v.Script?.trim() || null,
      AutoTopUp: saved?.AutoTopUp ?? false, HoldSize: saved?.HoldSize ?? 10, MaxAttempts: saved?.MaxAttempts ?? 3,
      RetryGapHours: saved?.RetryGapHours ?? 4, Status: saved?.Status ?? "active",
    });
    const r = await call(CALLING_ENDPOINTS.saveList, body);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onSaved({ ...body, Id: r.data?.Id ?? body.Id });
  };

  const pick = (opts, field, label, testId, required) => (
    <Combobox label={label} required={required} options={opts} value={opts.find((o) => o.value === field.value) ?? null}
      onChange={(o) => field.onChange(o?.value ?? null)} error={errors[field.name]?.message} data-testid={testId} />
  );
  return (
    <>
      <Modal.Body>
        <Steps step="details" />
        <FormGrid>
          <Controller control={control} name="Name" render={({ field }) => (
            <TextInput label="List name" required hint="Unique in your company" {...field} error={errors.Name?.message} data-testid="list-Name" />
          )} />
          <Controller control={control} name="BranchId" render={({ field }) => pick(branches, field, "Office", "list-BranchId", true)} />
          <Controller control={control} name="Vendor" render={({ field }) => <TextInput label="Bought from" {...field} data-testid="list-Vendor" />} />
          <Controller control={control} name="PurchasedOn" render={({ field }) => <DateField label="Bought on" value={field.value} onChange={field.onChange} data-testid="list-PurchasedOn" />} />
          {admin && (
            <Controller control={control} name="Cost" render={({ field }) => (
              <TextInput label="Cost" hint="Optional · admins only" type="number" inputMode="decimal" leftAdornment="₹" {...field} error={errors.Cost?.message} data-testid="list-Cost" />
            )} />
          )}
          <Controller control={control} name="ProductId" render={({ field }) => pick(products, field, "Product", "list-ProductId", false)} />
          <FormGridSpan>
            <Controller control={control} name="Script" render={({ field }) => (
              <TextArea label="Script" hint="Shown to the caller on the phone" rows={3} {...field} data-testid="list-Script" />
            )} />
          </FormGridSpan>
        </FormGrid>
        {error && <Note tone="error" testId="list-error">{error}</Note>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={handleSubmit(submit)} loading={busy} data-testid="list-next">Next: upload sheet</Button>
      </Modal.Footer>
    </>
  );
}

function SheetStep({ list, adding, last, onBack, onDone }) {
  const p = useTheme().tokens;
  const [sheet, setSheet] = useState(null);
  const [mapping, setMapping] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);       // { counts, skipped }
  const [imported, setImported] = useState(null);     // { at, counts, done }

  const built = useMemo(() => (sheet ? buildRows(sheet.rows, mapping, sheet.headers) : { rows: [], repeated: [] }), [sheet, mapping]);
  const hasMobile = mapping.includes("Mobile");
  const reasons = useMemo(() => new Map([
    ...built.repeated.map((r) => [r, "Repeated in sheet"]),
    ...(preview?.skipped ?? []).map((s) => [s.RowNo, s.Reason]),
  ]), [built, preview]);
  const skippedList = [...reasons].map(([RowNo, Reason]) => ({ RowNo, Reason }));

  const onFile = async (file) => {
    if (!file) return;
    setError(""); setPreview(null); setImported(null); setSheet(null);
    let read;
    try { read = await readSheet(file); } catch { return setError("Could not read this file. Save it as .xlsx or .csv and try again."); }
    if (!read.rows.length) return setError("This sheet has no rows");
    if (read.rows.length > MAX_ROWS) return setError("A sheet can have at most 50,000 rows");
    setSheet({ name: file.name, ...read });
    setMapping(guessMapping(read.headers));
  };
  const remap = (j, value) => { setMapping((m) => m.map((t, i) => (i === j ? value : t))); setPreview(null); setImported(null); };

  // Sends the chunks in order. A dry run always starts over; an import resumes at the chunk that failed
  // (re-sending it is safe: the unique index adds nothing twice).
  const run = async (dry) => {
    const parts = chunks(built.rows);
    let i = dry ? 0 : imported?.at ?? 0;
    const counts = dry ? { ...ZERO } : { ...(imported?.counts ?? ZERO) };
    const skipped = [];
    setBusy(true); setError("");
    for (; i < parts.length; i += 1) {
      const r = await call(CALLING_ENDPOINTS.importContacts, { CallListId: list.Id, DryRun: dry, rows: parts[i] });
      if (!r.ok) {
        setBusy(false);
        if (dry) return setError(r.message);
        setImported({ at: i, counts, done: false });
        return setError(`Stopped at row ${sheetRow(parts[i][0].RowNo)}. Nothing is lost — press Import to continue`);
      }
      for (const [k] of COUNT_LABELS) counts[k] += Number(r.data?.counts?.[k] ?? 0);
      skipped.push(...(r.data?.skipped ?? []));
    }
    setBusy(false);
    if (dry) setPreview({ counts, skipped });
    else setImported({ at: parts.length, counts, done: true });
  };

  const download = () => {
    const blob = new Blob([skippedCsv(sheet.headers, sheet.rows, skippedList)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${list.Name || "list"} - skipped rows.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const shown = imported?.done ? imported.counts : preview?.counts;
  const total = (k) => Number(shown?.[k] ?? 0) + (k === "Repeated" ? built.repeated.length : 0);
  const done = imported?.done;

  return (
    <>
      <Modal.Body>
        {!adding && <Steps step="sheet" />}
        {!sheet ? (
          <Box component="label" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
            sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, p: 4, border: `2px dashed ${p.border.strong}`, borderRadius: "calc(12rem / 15)", background: p.surface.subtle, cursor: "pointer", textAlign: "center" }}>
            <CloudUpload size={32} color={p.primary.main} />
            <Box sx={{ fontWeight: 700 }}>Drop the sheet here, or browse</Box>
            <Box sx={{ fontSize: "calc(13rem / 15)", color: p.text.secondary }}>.xlsx or .csv · up to 50,000 rows · any column layout — you tell us which column is the mobile</Box>
            <input type="file" accept=".xlsx,.csv" hidden data-testid="sheet-file" onChange={(e) => onFile(e.target.files?.[0])} />
          </Box>
        ) : (
          <>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5, fontSize: "calc(13rem / 15)" }}>
              <FileSpreadsheet size={16} color={p.success.main} />
              <Box sx={{ flex: 1 }}><b>{sheet.name}</b>{` · ${sheet.rows.length.toLocaleString("en-IN")} rows · ${sheet.headers.length} columns`}</Box>
              {!done && <Button size="sm" variant="ghost" onClick={() => { setSheet(null); setPreview(null); setImported(null); }}>Change file</Button>}
            </Box>
            <Box sx={{ fontSize: "calc(13rem / 15)", fontWeight: 600, mb: 1 }}>
              What is in each column? <Box component="span" sx={{ color: p.text.secondary, fontWeight: 500 }}>Only Mobile is required; anything else is kept as extra lines for the caller.</Box>
            </Box>
            <Box sx={{ display: "flex", gap: 1, overflowX: "auto", pb: 1 }}>
              {sheet.headers.map((h, j) => (
                <Box key={`${h}-${j}`} sx={{ minWidth: "calc(150rem / 15)", flex: "0 0 calc(150rem / 15)" }} data-testid={`map-col-${j}`}>
                  <Box sx={{ fontWeight: 600, fontSize: "calc(12rem / 15)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h}</Box>
                  <Box sx={{ fontSize: "calc(12rem / 15)", color: p.text.tertiary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", mb: 0.5 }}>{sheet.rows[0]?.[j] || "—"}</Box>
                  <Combobox size="sm" options={TARGETS} disableClearable disabled={busy || done} value={TARGETS.find((t) => t.value === mapping[j])}
                    onChange={(o) => remap(j, o?.value ?? "extra")} aria-label={`Column ${h}`} data-testid={`map-${j}`} />
                </Box>
              ))}
            </Box>
            {!hasMobile && <Note tone="error" testId="no-mobile">Choose which column is the mobile number. Nothing can be added without one.</Note>}
            {shown && (
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, mt: 1.5 }} data-testid="import-counts">
                {COUNT_LABELS.map(([k, label]) => (
                  <Box key={k} sx={{ background: p.surface.subtle, borderRadius: "calc(8rem / 15)", p: 1 }} data-testid={`count-${k}`}>
                    <Box sx={{ fontSize: "calc(11rem / 15)", color: p.text.secondary }}>{label}</Box>
                    <Box sx={{ fontSize: "calc(18rem / 15)", fontWeight: 700 }}>{total(k).toLocaleString("en-IN")}</Box>
                  </Box>
                ))}
              </Box>
            )}
            {hasMobile && (
              <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", mt: 1.5, fontSize: "calc(12rem / 15)", "& th, & td": { textAlign: "left", p: "calc(6rem / 15)", borderBottom: `1px solid ${p.border.subtle}` } }}>
                <thead><tr><th>Row</th><th>Name</th><th>Mobile</th><th>Alt mobile</th><th>City</th><th>Extra lines</th>{preview && <th>Check</th>}</tr></thead>
                <tbody>
                  {sheet.rows.slice(0, PREVIEW_ROWS).map((_, i) => {
                    const RowNo = i + 1;
                    const r = built.rows.find((x) => x.RowNo === RowNo);
                    const why = reasons.get(RowNo);
                    return (
                      <tr key={RowNo} data-testid={`preview-row-${RowNo}`}>
                        <td>{sheetRow(RowNo)}</td><td>{r?.Name ?? "—"}</td><td>{r?.Mobile || "—"}</td><td>{r?.AltMobile ?? "—"}</td><td>{r?.City ?? "—"}</td>
                        <td>{r?.Extra ? Object.entries(r.Extra).map(([k, v]) => `${k} ${v}`).join(" · ") : "—"}</td>
                        {preview && <td><Chip size="sm" tone={why ? "warning" : "success"} label={why ?? "Will be added"} /></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </Box>
            )}
          </>
        )}
        {error && <Note tone="error" testId="sheet-error">{error}</Note>}
        {done && <Note tone="success" testId="import-done">{`${total("Added").toLocaleString("en-IN")} contacts added to ${list.Name}.`}</Note>}
      </Modal.Body>
      <Modal.Footer>
        {preview && skippedList.length > 0 && (
          <Button variant="text" size="sm" leftIcon={<Download size={14} />} onClick={download} data-testid="download-skipped">
            {`Download ${skippedList.length} skipped rows`}
          </Button>
        )}
        {!adding && !done && <Button variant="ghost" onClick={onBack} disabled={busy}>Back</Button>}
        {!preview && !done && <Button disabled={!sheet || !hasMobile || busy} loading={busy} onClick={() => run(true)} data-testid="preview-btn">Preview</Button>}
        {preview && !done && <Button loading={busy} onClick={() => run(false)} data-testid="import-btn">Import</Button>}
        {done && <Button onClick={onDone} data-testid="sheet-next">{last ? "Done" : "Next: callers"}</Button>}
      </Modal.Footer>
    </>
  );
}

function CallersStep({ list, onDone }) {
  const p = useTheme().tokens;
  const { users } = useAssignableUsers({ module: "leads" });
  const [give, setGive] = useState({});
  const [auto, setAuto] = useState(Boolean(list.AutoTopUp));
  const [hold, setHold] = useState(String(list.HoldSize ?? 10));
  const [picks, setPicks] = useState(() => new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...users]
      .filter((u) => !q || [u.FullName, u.JobTitle, u.BranchName].some((v) => String(v ?? "").toLowerCase().includes(q)))
      .sort((a, b) => (a.GroupRank ?? 3) - (b.GroupRank ?? 3));
  }, [users, query]);
  const togglePick = (id) => setPicks((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const save = async () => {
    const Assign = Object.entries(give).map(([UserId, c]) => ({ UserId: Number(UserId), Count: Number(c) })).filter((x) => x.Count > 0);
    const holdN = Number(hold);
    if (auto && !picks.size) return setError("Pick at least one caller for automatic hand-out");
    if (auto && !(Number.isInteger(holdN) && holdN >= 1 && holdN <= 200)) return setError("Hold must be 1 to 200");
    if (!Assign.length && !auto) return onDone();
    setBusy(true); setError("");
    const lines = [];
    if (Assign.length) {
      const r = await call(CALLING_ENDPOINTS.assign, { CallListId: list.Id, Assign });
      if (!r.ok) { setBusy(false); return setError(r.message); }
      lines.push(r.message);
    }
    if (auto) {
      const s = await call(CALLING_ENDPOINTS.saveList, listBody(list, { AutoTopUp: true, HoldSize: holdN }));
      const c = s.ok ? await call(CALLING_ENDPOINTS.saveCallers, { CallListId: list.Id, Callers: [...picks].map((UserId) => ({ UserId, IsPaused: false })) }) : s;
      if (!c.ok) { setBusy(false); return setError(c.message); }
      lines.push(`Automatic hand-out is on: ${picks.size} ${picks.size === 1 ? "caller holds" : "callers hold"} ${holdN} at a time.`);
    }
    setBusy(false);
    setResult(lines.join(" "));
  };

  let lastGroup = null;
  return (
    <>
      <Modal.Body>
        <Steps step="callers" />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, p: "calc(12rem / 15) calc(16rem / 15)", background: p.surface.subtle, borderRadius: "calc(8rem / 15)" }}>
          <Switch checked={auto} onChange={(e) => setAuto(e.target.checked)} data-testid="auto-switch" aria-label="Automatic" />
          <Box sx={{ flex: 1 }}>
            <Box sx={{ fontWeight: 700 }}>Automatic</Box>
            <Box sx={{ fontSize: "calc(13rem / 15)", color: p.text.secondary }}>Each caller holds a batch. When they finish it, the next batch arrives by itself.</Box>
          </Box>
          {auto && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: "calc(13rem / 15)" }}>
              Hold <Box sx={{ width: "calc(72rem / 15)" }}><TextInput size="sm" type="number" value={hold} onChange={(e) => setHold(e.target.value)} aria-label="Hold at a time" data-testid="hold-size" /></Box> at a time
            </Box>
          )}
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 2, mb: 1 }}>
          <Box sx={{ flex: 1, fontSize: "calc(13rem / 15)", fontWeight: 600 }}>Callers <Box component="span" sx={{ color: p.text.secondary, fontWeight: 500 }}>— people you may assign leads to</Box></Box>
          <Box sx={{ width: "calc(200rem / 15)" }}><TextInput size="sm" placeholder="Find a person…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a person" /></Box>
        </Box>
        <Box sx={{ border: `1px solid ${p.border.default}`, borderRadius: "calc(8rem / 15)", maxHeight: "calc(320rem / 15)", overflowY: "auto" }}>
          {!shown.length && <Box sx={{ p: 2, color: p.text.secondary, fontSize: "calc(13rem / 15)" }}>Nobody to give contacts to. Ask an admin.</Box>}
          {shown.map((u) => {
            const group = GROUPS[u.GroupRank] ?? GROUPS[3];
            const head = group !== lastGroup ? (lastGroup = group) : null;
            return (
              <Box key={u.Id}>
                {head && <Box sx={{ px: 1.5, py: 0.5, background: p.surface.subtle, fontSize: "calc(11rem / 15)", fontWeight: 700, color: p.text.secondary, textTransform: "uppercase" }}>{head}</Box>}
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 1.5, py: 1, borderTop: `1px solid ${p.border.subtle}` }} data-testid={`caller-${u.Id}`}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ fontWeight: 600, fontSize: "calc(13rem / 15)" }}>{u.FullName}</Box>
                    <Box sx={{ fontSize: "calc(12rem / 15)", color: p.text.tertiary }}>{[u.JobTitle, u.BranchName].filter(Boolean).join(" · ")}</Box>
                  </Box>
                  <Box sx={{ width: "calc(84rem / 15)" }}>
                    <TextInput size="sm" type="number" placeholder="0" value={give[u.Id] ?? ""} onChange={(e) => setGive((g) => ({ ...g, [u.Id]: e.target.value }))}
                      aria-label={`Give ${u.FullName} now`} data-testid={`give-${u.Id}`} />
                  </Box>
                  {auto && <Switch checked={picks.has(u.Id)} onChange={() => togglePick(u.Id)} aria-label={`${u.FullName} on automatic`} data-testid={`auto-${u.Id}`} />}
                </Box>
              </Box>
            );
          })}
        </Box>
        {error && <Note tone="error" testId="callers-error">{error}</Note>}
        {result && <Note tone="success" testId="callers-result">{result}</Note>}
      </Modal.Body>
      <Modal.Footer>
        {result ? <Button onClick={onDone} data-testid="callers-done">Done</Button> : (
          <>
            <Button variant="ghost" onClick={onDone} disabled={busy}>Skip for now</Button>
            <Button loading={busy} onClick={save} data-testid="callers-save">Hand out</Button>
          </>
        )}
      </Modal.Footer>
    </>
  );
}

/** New list (no `list`) or Add contacts to `list` (opens on the Sheet step). */
export default function ListFormModal({ open, onClose, list = null }) {
  const qc = useQueryClient();
  const { edit } = useAccess("calling");
  const last = Boolean(list) || !edit; // the Sheet is the last step
  const n = edit ? 3 : 2;
  const [step, setStep] = useState(list ? "sheet" : "details");
  const [saved, setSaved] = useState(list ? listBody(list) : null);
  const close = () => {
    qc.invalidateQueries({ queryKey: ["calling-lists"] });
    qc.invalidateQueries({ queryKey: ["calling-list"] });
    qc.invalidateQueries({ queryKey: ["calling-contacts"] });
    onClose?.();
  };
  const sub = { details: `Step 1 of ${n} · what was bought`, sheet: `Step 2 of ${n} · ${saved?.Name ?? ""}`, callers: `Step 3 of 3 · who calls · ${saved?.Name ?? ""}` }[step];
  return (
    <Modal open={open} onClose={close} size={step === "sheet" ? "xl" : "lg"} dismissOnBackdrop={false} data-testid="list-form-modal">
      <Modal.Header title={list ? `Add contacts · ${list.Name}` : "New calling list"} subtitle={list ? undefined : sub} icon={<FileSpreadsheet size={18} />} onClose={close} />
      {step === "details" && <DetailsStep saved={saved} onCancel={close} onSaved={(b) => { setSaved(b); setStep("sheet"); }} />}
      {step === "sheet" && <SheetStep list={saved} adding={Boolean(list)} last={last} onBack={() => setStep("details")} onDone={() => (last ? close() : setStep("callers"))} />}
      {step === "callers" && <CallersStep list={saved} onDone={close} />}
    </Modal>
  );
}
