// src/pages/Sales/DoNotCall.jsx — /sales/do-not-call (spec 13.4). The company's own list.
// List managers (calling edit) read it; Owner / Admin add and clear, each with a note.
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { MaterialReactTable } from "material-react-table";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, Plus, X } from "lucide-react";

import { Button, Chip, EmptyState, Modal, Tabs, TextArea } from "../../components/ui";
import PageHeader from "../../components/ui/PageHeader";
import PhoneMarkModal from "../../components/PhoneMarkModal";
import useServerTable from "../../hooks/useServerTable";
import { useAccess, useIsAdmin } from "../../hooks/useAccess";
import { PHONE_MARK_ENDPOINTS, call } from "../../api/callingQueries";
import { formatDateTime } from "../../utils/format";

const TABS = [{ value: "live", label: "Live" }, { value: "history", label: "History" }];

function ClearModal({ mark, onClose, onDone }) {
  const p = useTheme().tokens;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const clear = async () => {
    if (!note.trim()) return setError("Write why the mark is cleared");
    setBusy(true); setError("");
    const r = await call(PHONE_MARK_ENDPOINTS.clear, { Id: mark.Id, ClearNote: note.trim() });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onDone();
    onClose();
  };
  return (
    <Modal open onClose={onClose} size="sm" data-testid="clear-mark-modal">
      <Modal.Header title="Clear this mark?" subtitle={`${mark.Mobile} · ${mark.Mark === "dnc" ? "Do not call" : "Call with caution"} · ${mark.SetByName ?? ""}`} icon={<X size={18} />} onClose={onClose} />
      <Modal.Body>
        <div style={{ fontSize: "calc(14rem / 15)", color: p.text.secondary, lineHeight: 1.5, marginBottom: "calc(12rem / 15)" }}>
          The number can be handed out and called again. The mark stays in History. A contact closed as do-not-call is not reopened; recycle it on its list if you mean to call it.
        </div>
        <TextArea label="Why" required rows={3} value={note} onChange={(e) => setNote(e.target.value)} error={error || undefined} data-testid="clear-note" />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="destructive" onClick={clear} loading={busy} data-testid="clear-confirm">Clear mark</Button>
      </Modal.Footer>
    </Modal>
  );
}

export default function DoNotCall() {
  const p = useTheme().tokens;
  const qc = useQueryClient();
  const { edit } = useAccess("calling");
  const admin = useIsAdmin();
  const [tab, setTab] = useState("live");
  const [adding, setAdding] = useState(false);
  const [clearing, setClearing] = useState(null);
  const history = tab === "history";

  const columns = useMemo(() => [
    { accessorKey: "Mobile", header: "Number", enableSorting: false },
    { accessorKey: "Mark", header: "Mark", enableSorting: false, Cell: ({ cell }) => (cell.getValue() === "dnc"
      ? <Chip size="sm" variant="solid" tone="error" label="Do not call" /> : <Chip size="sm" tone="warning" label="Call with caution" />) },
    { accessorKey: "Note", header: "Note", enableSorting: false, grow: true },
    { accessorKey: "SetByName", header: "Marked by", enableSorting: false, Cell: ({ row: { original: m } }) => (
      <span>{m.SetByName || "—"}{m.Source && m.Source !== "caller" && <span style={{ color: p.text.tertiary, fontSize: "calc(12rem / 15)" }}>{` · ${m.Source}`}</span>}</span>
    ) },
    { accessorKey: "SetAt", header: "When", enableSorting: false, Cell: ({ cell }) => formatDateTime(cell.getValue(), { empty: "—" }) },
    { id: "where", header: "Where it appears", enableSorting: false, Cell: ({ row: { original: m } }) => {
      const links = [
        m.LeadId && <Link key="l" to={`/sales/leads/${m.LeadId}`}>Lead</Link>,
        m.CustomerId && <Link key="c" to={`/support/customers?customerId=${m.CustomerId}`}>Customer</Link>,
        m.CallListId && <Link key="k" to={`/sales/calling-lists/${m.CallListId}?tab=contacts`}>Calling list</Link>,
      ].filter(Boolean);
      return links.length ? <Box sx={{ display: "flex", gap: 1 }}>{links}</Box> : <span style={{ color: p.text.tertiary }}>Not in the CRM yet</span>;
    } },
    ...(history ? [{ id: "cleared", header: "Cleared", enableSorting: false, accessorFn: (m) => (m.ClearedAt
      ? `${m.ClearedByName ?? ""}, ${formatDateTime(m.ClearedAt)}${m.ClearNote ? ` — ${m.ClearNote}` : ""}` : "—") }] : []),
  ], [history, p]);

  const { table } = useServerTable({
    columns, queryKey: "phone-marks", endpoint: PHONE_MARK_ENDPOINTS.fetch, dataKey: "marks",
    extraParams: history ? { History: true } : {}, enabled: edit,
    getRowId: (r) => String(r.Id),
    enableRowActions: admin && !history,
    positionActionsColumn: "last",
    displayColumnDefOptions: { "mrt-row-actions": { grow: false, header: "" } },
    renderRowActions: ({ row }) => (
      <Button size="sm" variant="ghost" leftIcon={<X size={14} />} onClick={() => setClearing(row.original)} data-testid={`clear-${row.original.Id}`}>Clear</Button>
    ),
    renderTopToolbarCustomActions: () => <Tabs size="sm" value={tab} onChange={setTab} items={TABS} data-testid="dnc-tabs" />,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["phone-marks"] });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
      <PageHeader
        title="Do not call"
        subtitle="The company's own list. A marked number is never handed out and shows a warning wherever it appears."
        actions={edit && admin ? <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setAdding(true)} data-testid="add-number-btn">Add number</Button> : null}
      />
      <Helmet><title>PRD Infotech | Do not call</title></Helmet>
      {edit ? <MaterialReactTable table={table} /> : (
        <EmptyState icon={<Ban size={32} />} title="The do-not-call list is managed by your manager"
          description="Mark a number from a call result on the phone, or ask your manager." />
      )}
      {adding && <PhoneMarkModal open onClose={() => setAdding(false)} invalidate={[["phone-marks"]]} />}
      {clearing && <ClearModal mark={clearing} onClose={() => setClearing(null)} onDone={refresh} />}
    </Box>
  );
}
