// src/pages/Sales/CallingLists/ListDetail.jsx — /sales/calling-lists/:listId (spec 13.3).
// Tabs Overview · Contacts · Callers · Settings, the active one in ?tab=. The funnel and
// money come from the sales report's `calllist` line (each number = its drill's total);
// the pool split and today's calls from the list row itself.
import { lazy, Suspense, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { FileSearch, Pause, Play, Upload, Users } from "lucide-react";

import { Button, Combobox, EmptyState, Switch, Tabs, TextArea, TextInput, DateField } from "../../../components/ui";
import PageHeader from "../../../components/ui/PageHeader";
import ConfirmationDialog from "../../../components/ConfirmationDialog";
import { useApiQuery } from "../../../hooks/useApiQuery";
import { useConfirmation } from "../../../hooks/useConfirmation";
import { useAccess, useIsAdmin } from "../../../hooks/useAccess";
import { CALLING_ENDPOINTS, call, listBody } from "../../../api/callingQueries";
import { SALES_ENDPOINTS } from "../../../api/salesQueries";
import { formatDate } from "../../../utils/format";
import { inr, ListStatusChip, num, pct } from "./CallingLists";
import ContactsTab from "./ContactsTab";
import CallersTab from "./CallersTab";
import GiveModal from "./GiveModal";

const ListFormModal = lazy(() => import("./ListFormModal"));

function Panel({ title, children, testId }) {
  const p = useTheme().tokens;
  return (
    <Box data-testid={testId} sx={{ background: p.surface.card, border: `1px solid ${p.border.default}`, borderRadius: "calc(12rem / 15)", p: 2.5 }}>
      {title && <Box sx={{ fontWeight: 700, fontSize: "calc(15rem / 15)", mb: 1.5 }}>{title}</Box>}
      {children}
    </Box>
  );
}

function Overview({ list, callers, admin }) {
  const p = useTheme().tokens;
  const reports = useAccess("sales_reports");
  const { data, error } = useApiQuery({
    queryKey: ["calling-list-report", list.Id], endpoint: SALES_ENDPOINTS.reports.sales,
    params: { GroupBy: "calllist", CallListId: list.Id }, enabled: reports.view, showErrorMessage: false, retry: false,
  });
  const line = (data?.rows ?? []).find((r) => Number(r.GroupKey) === list.Id) ?? data?.rows?.[0] ?? null;
  const steps = line ? [["Contacts", line.ListContacts], ["Called", line.DialContacts], ["Reached", line.DialReached], ["Turned lead", list.Leads], ["Won", line.CohortWon]] : [];
  const top = Number(steps[0]?.[1]) || 0;
  const cost = line?.ListCost;
  const pool = [["in pool", list.InPool, p.border.strong], ["with callers", list.Held, p.primary.main], ["callbacks", list.Callbacks, p.info.main],
    ["closed", list.Closed, p.text.secondary], ["turned lead", list.Leads, p.success.main]];
  const poolTotal = pool.reduce((a, [, v]) => a + Number(v ?? 0), 0);

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1.35fr 1fr" }, gap: 2, alignItems: "start" }}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Panel title="What came out of it" testId="funnel">
          {!reports.view && <Box sx={{ color: p.text.secondary, fontSize: "calc(13rem / 15)" }}>The figures need Sales reports access.</Box>}
          {reports.view && error && <Box role="alert" sx={{ color: p.error.main, fontSize: "calc(13rem / 15)" }}>Couldn't load the figures.</Box>}
          {steps.map(([k, v], i) => (
            <Box key={k} sx={{ display: "grid", gridTemplateColumns: "calc(80rem / 15) 1fr calc(70rem / 15) calc(50rem / 15)", alignItems: "center", gap: 1.5, py: 0.75, fontSize: "calc(13rem / 15)" }} data-testid={`funnel-${k}`}>
              <span>{k}</span>
              <Box sx={{ height: "calc(10rem / 15)", background: p.surface.track, borderRadius: "calc(6rem / 15)", overflow: "hidden" }}>
                <Box sx={{ height: "100%", width: `${top ? Math.max((Number(v) / top) * 100, 0.8) : 0}%`, background: i > 2 ? p.success.main : p.primary.main }} />
              </Box>
              <Box sx={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{num(v)}</Box>
              <Box sx={{ textAlign: "right", color: p.text.tertiary }}>{i ? pct(v, steps[i - 1][1]) : ""}</Box>
            </Box>
          ))}
          {line && (
            <Box sx={{ mt: 1.5, fontSize: "calc(12rem / 15)", color: p.text.tertiary }}>
              Reached = interested + not interested + call back + do not call. Each % is of the step above.{" "}
              <Link to={`/reports/sales/calling/rows?${new URLSearchParams({ line: "calllist", metric: "dial", shape: "events", key: String(list.Id), preset: "any" })}`} data-testid="every-call">See every call</Link>
            </Box>
          )}
        </Panel>
        {admin && cost != null && (
          <Panel title="Money" testId="money">
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2 }}>
              {[["Cost", inr(cost)], ["Cost per lead", Number(list.Leads) ? inr(cost / list.Leads) : "—"], ["Won value", inr(line.CohortWonValue ?? 0)],
                ["Back per ₹1 spent", Number(cost) ? `₹${(Number(line.CohortWonValue ?? 0) / Number(cost)).toFixed(1)}` : "—"]].map(([k, v]) => (
                <Box key={k}><Box sx={{ fontSize: "calc(12rem / 15)", color: p.text.secondary }}>{k}</Box><Box sx={{ fontWeight: 700, fontSize: "calc(18rem / 15)" }}>{v}</Box></Box>
              ))}
            </Box>
          </Panel>
        )}
      </Box>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Panel title={`Today · ${num(list.CalledToday)} calls`} testId="today">
          {!callers.length ? <Box sx={{ color: p.text.secondary, fontSize: "calc(13rem / 15)" }}>No callers on this list yet.</Box> : (
            <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: "calc(13rem / 15)", "& th, & td": { p: "calc(6rem / 15) 0", textAlign: "left" }, "& th": { color: p.text.secondary, fontWeight: 600 } }}>
              <thead><tr><th>Caller</th><th>Calls</th><th>Turned lead</th><th>Holding</th></tr></thead>
              <tbody>{callers.map((c) => <tr key={c.UserId}><td>{c.FullName}</td><td>{num(c.CalledToday)}</td><td>{num(c.Leads)}</td><td>{num(c.Holding)}</td></tr>)}</tbody>
            </Box>
          )}
        </Panel>
        <Panel title="Pool" testId="pool">
          <Box sx={{ display: "flex", height: "calc(10rem / 15)", borderRadius: "calc(6rem / 15)", overflow: "hidden", gap: "2px", background: p.surface.track }}>
            {pool.map(([k, v, c]) => <Box key={k} sx={{ width: `${poolTotal ? (Number(v ?? 0) / poolTotal) * 100 : 0}%`, background: c }} />)}
          </Box>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: "calc(4rem / 15) calc(16rem / 15)", mt: 1.5, fontSize: "calc(12rem / 15)", color: p.text.secondary }}>
            {pool.map(([k, v]) => <span key={k}><b style={{ color: p.text.primary }}>{num(v)}</b>{` ${k}`}</span>)}
          </Box>
        </Panel>
      </Box>
    </Box>
  );
}

function Settings({ list, canDelete, onSaved }) {
  const p = useTheme().tokens;
  const admin = useIsAdmin();
  const navigate = useNavigate();
  const confirmation = useConfirmation();
  const [v, setV] = useState(() => ({
    Name: list.Name ?? "", Vendor: list.Vendor ?? "", PurchasedOn: list.PurchasedOn ? String(list.PurchasedOn).slice(0, 10) : null,
    Cost: list.Cost == null ? "" : String(list.Cost), Script: list.Script ?? "", AutoTopUp: Boolean(list.AutoTopUp),
    HoldSize: String(list.HoldSize ?? 10), MaxAttempts: String(list.MaxAttempts ?? 3), RetryGapHours: String(list.RetryGapHours ?? 4),
    ProductId: list.ProductId ?? null,
  }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: productData } = useApiQuery({ queryKey: ["products", "active"], endpoint: SALES_ENDPOINTS.products.fetchProducts, params: { PageSize: 200, IsActive: true }, showErrorMessage: false });
  const products = (productData?.products ?? []).map((x) => ({ value: x.Id, label: x.Name }));
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const int = (s, lo, hi) => { const n = Number(s); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };

  const save = async (over = {}) => {
    const HoldSize = int(v.HoldSize, 1, 200), MaxAttempts = int(v.MaxAttempts, 1, 10), RetryGapHours = int(v.RetryGapHours, 0, 168);
    if (!v.Name.trim()) return setError("Name is required");
    if (HoldSize == null) return setError("Each caller holds 1 to 200");
    if (MaxAttempts == null) return setError("Tries per contact must be 1 to 10");
    if (RetryGapHours == null) return setError("Gap between tries must be 0 to 168 hours");
    if (admin && v.Cost && !(Number(v.Cost) >= 0)) return setError("Cost must be 0 or more");
    setBusy(true); setError("");
    const r = await call(CALLING_ENDPOINTS.saveList, listBody(list, {
      Name: v.Name.trim(), Vendor: v.Vendor.trim() || null, PurchasedOn: v.PurchasedOn || null, Script: v.Script.trim() || null,
      ProductId: v.ProductId, AutoTopUp: v.AutoTopUp, HoldSize, MaxAttempts, RetryGapHours,
      ...(admin ? { Cost: v.Cost ? Number(v.Cost) : null } : {}), ...over,
    }));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onSaved();
  };
  const archive = () => confirmation.showConfirmation({
    title: "Archive this list?", type: "warning", confirmText: "Archive",
    message: "Contacts with callers go back to the pool. The figures stay in reports.", onConfirm: () => save({ Status: "archived" }),
  });
  const remove = () => confirmation.showConfirmation({
    title: "Delete this list?", type: "danger", confirmText: "Delete", message: "Only a list nobody has called yet can be deleted.",
    onConfirm: async () => {
      const r = await call(CALLING_ENDPOINTS.deleteList, { Id: list.Id });
      if (!r.ok) return setError(r.message);
      navigate("/sales/calling-lists");
    },
  });

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, gap: 2, alignItems: "start" }}>
      <Panel title="Details">
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
          <TextInput label="List name" required value={v.Name} onChange={set("Name")} data-testid="set-Name" />
          <TextInput label="Bought from" value={v.Vendor} onChange={set("Vendor")} data-testid="set-Vendor" />
          <DateField label="Bought on" value={v.PurchasedOn} onChange={set("PurchasedOn")} />
          {admin && <TextInput label="Cost" type="number" leftAdornment="₹" value={v.Cost} onChange={set("Cost")} data-testid="set-Cost" />}
          <Combobox label="Product" options={products} value={products.find((o) => o.value === v.ProductId) ?? null} onChange={(o) => set("ProductId")(o?.value ?? null)} />
        </Box>
        <Box sx={{ mt: 2 }}><TextArea label="Script" rows={3} value={v.Script} onChange={set("Script")} /></Box>
      </Panel>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Panel title="Handing out">
          <Switch checked={v.AutoTopUp} onChange={(e) => set("AutoTopUp")(e.target.checked)} label="Automatic top-up: a caller who finishes their batch gets the next one" data-testid="set-AutoTopUp" />
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 2, mt: 2 }}>
            <TextInput label="Each caller holds" type="number" value={v.HoldSize} onChange={set("HoldSize")} hint="Per caller override on Callers" data-testid="set-HoldSize" />
            <TextInput label="Tries per contact" type="number" value={v.MaxAttempts} onChange={set("MaxAttempts")} hint="Then closed as no response" data-testid="set-MaxAttempts" />
            <TextInput label="Gap between tries" type="number" value={v.RetryGapHours} onChange={set("RetryGapHours")} rightAdornment="hours" data-testid="set-RetryGapHours" />
          </Box>
        </Panel>
        <Panel title="Status">
          <Box sx={{ display: "flex", gap: 1 }}>
            {list.Status !== "archived" && <Button size="sm" variant="tonal" onClick={archive} data-testid="set-archive">Archive</Button>}
            <Box sx={{ flex: 1 }} />
            {canDelete && <Button size="sm" variant="destructive" onClick={remove} data-testid="set-delete">Delete list</Button>}
          </Box>
          <Box sx={{ mt: 1, fontSize: "calc(12rem / 15)", color: p.text.tertiary }}>Archived: contacts with callers go back to the pool and nothing more is handed out.</Box>
        </Panel>
        {error && <Box role="alert" sx={{ color: p.error.main, fontSize: "calc(13rem / 15)" }} data-testid="settings-error">{error}</Box>}
        <Box sx={{ display: "flex", justifyContent: "flex-end" }}><Button loading={busy} onClick={() => save()} data-testid="set-save">Save changes</Button></Box>
      </Box>
      <ConfirmationDialog
        open={confirmation.isOpen} onClose={confirmation.hideConfirmation} onConfirm={confirmation.handleConfirm}
        title={confirmation.confirmationState.title} message={confirmation.confirmationState.message}
        confirmText={confirmation.confirmationState.confirmText} cancelText={confirmation.confirmationState.cancelText}
        type={confirmation.confirmationState.type} isLoading={confirmation.isLoading}
      />
    </Box>
  );
}

export default function ListDetail() {
  const { listId } = useParams();
  const id = Number(listId);
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const access = useAccess("calling");
  const admin = useIsAdmin();
  const [modal, setModal] = useState(null); // "add" | "give"
  const { data, error, isLoading } = useApiQuery({
    queryKey: ["calling-list", id], endpoint: CALLING_ENDPOINTS.fetchLists, params: { Id: id }, enabled: access.view && id > 0, showErrorMessage: false, retry: false,
  });
  const list = data?.list;
  const callers = data?.callers ?? [];
  const refresh = () => { qc.invalidateQueries({ queryKey: ["calling-list"] }); qc.invalidateQueries({ queryKey: ["calling-lists"] }); };

  const tabs = [
    { value: "overview", label: "Overview" },
    ...(access.edit ? [{ value: "contacts", label: "Contacts", badge: list ? num(list.Contacts) : undefined }] : []),
    { value: "callers", label: "Callers", badge: callers.length },
    ...(access.edit ? [{ value: "settings", label: "Settings" }] : []),
  ];
  const tab = tabs.some((t) => t.value === params.get("tab")) ? params.get("tab") : "overview";
  const crumbs = [{ label: "Sales" }, { label: "Calling Lists", to: "/sales/calling-lists" }];

  if (!access.view || (error && !list)) {
    const nf = !access.view || error?.response?.status === 404;
    return (
      <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
        <PageHeader title="Calling list" breadcrumb={crumbs} />
        <EmptyState icon={<FileSearch size={32} />} title={nf ? "Calling list not found" : "Couldn't load this list"}
          description={nf ? "It may have been deleted, or it belongs to an office you do not manage." : "Check your connection and try again."} />
      </Box>
    );
  }
  if (isLoading || !list) return <Box sx={{ flexGrow: 1 }}><PageHeader title="Calling list" breadcrumb={crumbs} /></Box>;

  const toggle = () => call(CALLING_ENDPOINTS.saveList, listBody(list, { Status: list.Status === "paused" ? "active" : "paused" })).then(refresh);
  const sub = [list.Vendor, list.PurchasedOn && `bought ${formatDate(list.PurchasedOn)}`, list.BranchName && `${list.BranchName} office`, list.ProductName].filter(Boolean).join(" · ");
  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
      <PageHeader
        title={list.Name} titleSuffix={<ListStatusChip list={list} />} subtitle={sub} breadcrumb={crumbs}
        actions={
          <Box sx={{ display: "flex", gap: 1 }}>
            {access.add && list.Status !== "archived" && <Button size="sm" variant="tonal" leftIcon={<Upload size={14} />} onClick={() => setModal("add")} data-testid="add-contacts-btn">Add contacts</Button>}
            {access.edit && list.Status !== "archived" && (
              <>
                <Button size="sm" variant="tonal" leftIcon={list.Status === "paused" ? <Play size={14} /> : <Pause size={14} />} onClick={toggle} data-testid="detail-pause">{list.Status === "paused" ? "Resume" : "Pause"}</Button>
                <Button size="sm" leftIcon={<Users size={14} />} onClick={() => setModal("give")} data-testid="detail-give">Give out</Button>
              </>
            )}
          </Box>
        }
      />
      <Helmet><title>{`PRD Infotech | ${list.Name}`}</title></Helmet>
      <Box sx={{ mt: 1, mb: 2 }}>
        <Tabs value={tab} items={tabs} onChange={(t) => setParams(t === "overview" ? {} : { tab: t })} data-testid="detail-tabs" />
      </Box>
      {tab === "overview" && <Overview list={list} callers={callers} admin={admin} />}
      {tab === "contacts" && <ContactsTab list={list} callers={callers} canAdd={access.add} />}
      {tab === "callers" && <CallersTab list={list} callers={callers} canEdit={access.edit} />}
      {tab === "settings" && <Settings key={list.UpdatedAt ?? list.Id} list={list} canDelete={admin} onSaved={refresh} />}
      {modal === "give" && <GiveModal open list={list} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === "add" && <Suspense fallback={null}><ListFormModal open list={list} onClose={() => { setModal(null); refresh(); }} /></Suspense>}
    </Box>
  );
}
