// src/pages/Sales/CallingLists/ContactsTab.jsx — the pool of one list (spec 13.3).
// Filters live in the address bar (?status=&caller=&result=&stale=1&missed=1) so the
// report's drill and the missed-callback notification land on the right rows.
// No export here, ever: bought data does not leave the CRM from this page.
import { useMemo, useState } from "react";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { MaterialReactTable } from "material-react-table";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Hourglass, RotateCcw, Trash2, Undo2, UserPlus, Users } from "lucide-react";

import { Button, Chip, Combobox, MobileInput, Modal, TextInput } from "../../../components/ui";
import useServerTable from "../../../hooks/useServerTable";
import { CALLING_ENDPOINTS, CALL_RESULT, CLOSE_REASON, CONTACT_STATUS, call } from "../../../api/callingQueries";
import { formatDateTime } from "../../../utils/format";
import GiveModal from "./GiveModal";
import ContactHistoryDrawer from "./ContactHistoryDrawer";

const MAX_PICK = 500;
const opts = (all, map) => [{ value: "", label: all }, ...Object.entries(map).map(([value, v]) => ({ value, label: typeof v === "string" ? v : v.label }))];
const STATUS_OPTS = opts("All statuses", CONTACT_STATUS);
const RESULT_OPTS = opts("Any last result", CALL_RESULT);

/** A confirm dialog that runs `action` and keeps the server's refusal on screen. */
export function ActionDialog({ open, title, message, confirmText, action, onClose, onDone, children }) {
  const p = useTheme().tokens;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    setBusy(true); setError("");
    const r = await action();
    setBusy(false);
    onDone?.();
    if (!r.ok) return setError(r.message);
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" data-testid="action-dialog">
      <Modal.Header title={title} onClose={onClose} />
      <Modal.Body>
        <Box sx={{ fontSize: "calc(14rem / 15)", color: p.text.secondary, lineHeight: 1.5 }}>{message}</Box>
        {children}
        {error && <Box role="alert" sx={{ mt: 1.5, color: p.error.main, fontSize: "calc(13rem / 15)" }} data-testid="action-error">{error}</Box>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={run} loading={busy} data-testid="action-confirm">{confirmText}</Button>
      </Modal.Footer>
    </Modal>
  );
}

function AddContactModal({ list, onClose, onDone }) {
  const p = useTheme().tokens;
  const [v, setV] = useState({ Name: "", Mobile: "", AltMobile: "", Company: "", City: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: typeof e === "string" ? e : e.target.value }));
  const save = async () => {
    setBusy(true); setError("");
    const r = await call(CALLING_ENDPOINTS.addContact, { CallListId: list.Id, ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim() || null])) });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onDone();
    onClose();
  };
  return (
    <Modal open onClose={onClose} size="md" data-testid="add-contact-modal">
      <Modal.Header title="Add a contact" subtitle={list.Name} icon={<UserPlus size={18} />} onClose={onClose} />
      <Modal.Body>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
          <TextInput label="Name" value={v.Name} onChange={set("Name")} data-testid="add-Name" />
          <MobileInput label="Mobile" required value={v.Mobile} onChange={set("Mobile")} data-testid="add-Mobile" />
          <MobileInput label="Alt mobile" value={v.AltMobile} onChange={set("AltMobile")} data-testid="add-AltMobile" />
          <TextInput label="Company" value={v.Company} onChange={set("Company")} data-testid="add-Company" />
          <TextInput label="City" value={v.City} onChange={set("City")} data-testid="add-City" />
        </Box>
        {error && <Box role="alert" sx={{ mt: 1.5, color: p.error.main, fontSize: "calc(13rem / 15)" }} data-testid="add-error">{error}</Box>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={!v.Mobile} loading={busy} data-testid="add-save">Add contact</Button>
      </Modal.Footer>
    </Modal>
  );
}

export default function ContactsTab({ list, callers = [], canAdd = false }) {
  const p = useTheme().tokens;
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [selection, setSelection] = useState({});
  const [dialog, setDialog] = useState(null);   // "give" | "recall" | "remove" | "recycle" | "add"
  const [drawer, setDrawer] = useState(null);

  const f = {
    status: params.get("status") ?? "", caller: Number(params.get("caller")) || null, result: params.get("result") ?? "",
    stale: params.get("stale") === "1", missed: params.get("missed") === "1",
  };
  const setFilter = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, String(v)); else next.delete(k);
    setParams(next, { replace: true });
    setSelection({});
  };
  const callerOpts = useMemo(() => [{ value: null, label: "All callers" }, ...callers.map((c) => ({ value: c.UserId, label: c.FullName }))], [callers]);

  const columns = useMemo(() => [
    { accessorKey: "Name", header: "Name", enableSorting: false, Cell: ({ row: { original: c } }) => (
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, fontWeight: 600 }}>{c.Name || "—"}
        {c.PhoneMark && <Chip size="sm" variant="solid" tone={c.PhoneMark === "dnc" ? "error" : "warning"} label={c.PhoneMark === "dnc" ? "Do not call" : "Caution"} />}
      </Box>
    ) },
    { accessorKey: "Mobile", header: "Mobile", enableSorting: false },
    { accessorKey: "City", header: "City", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "Status", header: "Status", enableSorting: false, Cell: ({ row: { original: c } }) => {
      const s = CONTACT_STATUS[c.Status] ?? CONTACT_STATUS.pool;
      return (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Chip size="sm" tone={s.tone} label={s.label} />
          {c.CloseReason && <Box component="span" sx={{ fontSize: "calc(12rem / 15)", color: p.text.tertiary }}>{CLOSE_REASON[c.CloseReason]}</Box>}
        </Box>
      );
    } },
    { accessorKey: "HeldByName", header: "With", enableSorting: false, Cell: ({ cell }) => cell.getValue() || "—" },
    { accessorKey: "Attempts", header: "Attempts", enableSorting: false },
    { accessorKey: "LastResult", header: "Last result", enableSorting: false, Cell: ({ cell }) => CALL_RESULT[cell.getValue()] ?? "—" },
    { accessorKey: "LastCalledAt", header: "Last called", enableSorting: false, Cell: ({ cell }) => formatDateTime(cell.getValue(), { empty: "—" }) },
    { accessorKey: "CallbackAt", header: "Callback at", enableSorting: false, Cell: ({ cell }) => formatDateTime(cell.getValue(), { empty: "—" }) },
  ], [p]);

  const { table, data, refetch } = useServerTable({
    columns, queryKey: "calling-contacts", endpoint: CALLING_ENDPOINTS.fetchContacts, dataKey: "contacts",
    extraParams: { CallListId: list.Id, Status: f.status || null, HeldBy: f.caller, LastResult: f.result || null, Stale: f.stale, Missed: f.missed },
    getRowId: (r) => String(r.Id),
    enableRowSelection: true,
    onRowSelectionChange: setSelection,
    state: { rowSelection: selection },
    muiTableBodyRowProps: ({ row }) => ({ hover: true, sx: { cursor: "pointer" }, onClick: () => setDrawer(row.original.Id) }),
  });

  const ids = Object.keys(selection).filter((k) => selection[k]).map(Number);
  const picked = data.filter((r) => selection[String(r.Id)]);
  const allCallbacks = picked.length > 0 && picked.length === ids.length && picked.every((r) => r.Status === "callback");
  const tooMany = ids.length > MAX_PICK;
  const refresh = () => { refetch(); qc.invalidateQueries({ queryKey: ["calling-list"] }); };
  const done = () => { setSelection({}); refresh(); };
  const state = (Action) => () => call(CALLING_ENDPOINTS.setState, { CallListId: list.Id, ContactIds: ids, Action });

  const quick = (key, Icon, label) => (
    <Button size="sm" variant={f[key] ? "secondary" : "tonal"} leftIcon={<Icon size={14} />} aria-pressed={f[key]} onClick={() => setFilter(key, f[key] ? "" : "1")} data-testid={`quick-${key}`}>{label}</Button>
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }}>
        <Box sx={{ width: "calc(170rem / 15)" }}>
          <Combobox size="sm" options={STATUS_OPTS} disableClearable value={STATUS_OPTS.find((o) => o.value === f.status)} onChange={(o) => setFilter("status", o?.value)} data-testid="contacts-status" />
        </Box>
        <Box sx={{ width: "calc(170rem / 15)" }}>
          <Combobox size="sm" options={callerOpts} disableClearable value={callerOpts.find((o) => o.value === f.caller) ?? callerOpts[0]} onChange={(o) => setFilter("caller", o?.value)} data-testid="contacts-caller" />
        </Box>
        <Box sx={{ width: "calc(170rem / 15)" }}>
          <Combobox size="sm" options={RESULT_OPTS} disableClearable value={RESULT_OPTS.find((o) => o.value === f.result)} onChange={(o) => setFilter("result", o?.value)} data-testid="contacts-result" />
        </Box>
        {quick("stale", Hourglass, "Held over 2 days")}
        {quick("missed", CalendarClock, "Missed callbacks")}
        <Box sx={{ flex: 1 }} />
        {canAdd && <Button size="sm" variant="tonal" leftIcon={<UserPlus size={14} />} onClick={() => setDialog("add")} data-testid="add-contact-btn">Add contact</Button>}
      </Box>
      {ids.length > 0 && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: "calc(8rem / 15) calc(12rem / 15)", background: p.primary.subtle, borderRadius: "calc(8rem / 15)" }} data-testid="bulk-bar">
          <Box sx={{ fontWeight: 700, fontSize: "calc(13rem / 15)" }}>{`${ids.length} selected`}</Box>
          {tooMany && <Box sx={{ fontSize: "calc(13rem / 15)", color: p.error.main }}>Select 500 or fewer</Box>}
          <Box sx={{ flex: 1 }} />
          <Button size="sm" leftIcon={<Users size={14} />} disabled={tooMany} onClick={() => setDialog("give")} data-testid="bulk-give">Give to…</Button>
          <Button size="sm" variant="tonal" leftIcon={<Undo2 size={14} />} disabled={tooMany} onClick={() => setDialog("recall")} data-testid="bulk-recall">Pull back</Button>
          <Button size="sm" variant="tonal" leftIcon={<RotateCcw size={14} />} disabled={tooMany} onClick={() => setDialog("recycle")} data-testid="bulk-recycle">Recycle</Button>
          <Button size="sm" variant="tonal" leftIcon={<Trash2 size={14} />} disabled={tooMany} onClick={() => setDialog("remove")} data-testid="bulk-remove">Remove</Button>
        </Box>
      )}
      <MaterialReactTable table={table} />

      {dialog === "give" && <GiveModal open list={list} contactIds={ids} moveCallbacks={allCallbacks} onClose={() => { setDialog(null); done(); }} onDone={refresh} />}
      {dialog === "recall" && (
        <ActionDialog open title={`Pull back ${ids.length} contacts?`} confirmText="Pull back" onClose={() => setDialog(null)} onDone={done}
          message="They go back to the pool and can be handed out again. Booked callbacks are pulled back too."
          action={() => call(CALLING_ENDPOINTS.recall, { CallListId: list.Id, ContactIds: ids, IncludeCallbacks: true })} />
      )}
      {dialog === "recycle" && (
        <ActionDialog open title={`Recycle ${ids.length} contacts?`} confirmText="Recycle" onClose={() => setDialog(null)} onDone={done}
          message="Closed as no response or not interested go back to the pool with their tries reset. This is logged." action={state("recycle")} />
      )}
      {dialog === "remove" && (
        <ActionDialog open title={`Remove ${ids.length} contacts?`} confirmText="Remove" onClose={() => setDialog(null)} onDone={done}
          message="They are closed as removed and never handed out again. Their calls stay in reports." action={state("remove")} />
      )}
      {dialog === "add" && <AddContactModal list={list} onClose={() => setDialog(null)} onDone={refresh} />}
      <ContactHistoryDrawer contactId={drawer} onClose={() => setDrawer(null)} />
    </Box>
  );
}
