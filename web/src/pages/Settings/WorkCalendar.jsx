// src/pages/Settings/WorkCalendar.jsx
// Work calendar for presence + task TAT (spec 2026-10-07 section 5): shifts,
// holidays, and the company rules (grace, buffer, warning point, go-live, TAT
// targets). Times are IST. Save buttons show only to people who can edit settings.
import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Box } from "@mui/material";
import { useSnackbar } from "notistack";
import { useQueryClient } from "@tanstack/react-query";

import PageHeader from "../../components/ui/PageHeader";
import Tabs from "../../components/ui/Tabs";
import Modal from "../../components/ui/Modal";
import Button from "../../components/ui/Button";
import TextInput from "../../components/ui/TextInput";
import DateField from "../../components/ui/DateField";
import Checkbox from "../../components/ui/Checkbox";
import Switch from "../../components/ui/Switch";
import Tooltip from "../../components/ui/Tooltip";
import ConfirmationDialog from "../../components/ConfirmationDialog";
import { FormSelect } from "../../components/Design/FormComponents";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useConfirmation } from "../../hooks";
import { useAccess } from "../../hooks/useAccess";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import {
  WORK_ENDPOINTS,
  saveCompanySetting,
  saveWorkCalendar,
  deleteWorkCalendar,
  saveHoliday,
  deleteHoliday,
  saveTatPolicy,
} from "../../api/workQueries";
import shiftWarnings from "./shiftWarnings";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // shown Monday first
const PRIORITIES = ["critical", "high", "medium", "low"];
const TABS = [
  { value: "shifts", label: "Shifts" },
  { value: "holidays", label: "Holidays" },
  { value: "rules", label: "Rules" },
];

// A DATE is "YYYY-MM-DD". A timestamp that carries a zone (Z / +hh:mm) is an instant, so read its IST day
// rather than slicing the UTC text, which is a day early for IST midnight.
const IST_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const dateOnly = (v) => {
  if (!v) return "";
  const s = String(v);
  return /T.*(Z|[+-]\d\d:?\d\d)$/.test(s) ? IST_DAY.format(new Date(s)) : s.slice(0, 10);
};
const msg = (e) => e.response?.data?.message || e.message || "Something went wrong";

const defaultDays = () =>
  DAY_NAMES.map((_, d) => ({
    d, on: d >= 1 && d <= 5, start: "09:30", end: "18:30", breakStart: "13:00", breakEnd: "14:00",
  }));

const seedDays = (saved) =>
  defaultDays().map((blank) => {
    const s = Array.isArray(saved) ? saved.find((x) => x.d === blank.d) : null;
    return s ? { ...blank, breakStart: "", breakEnd: "", ...s } : { ...blank, on: saved ? false : blank.on };
  });

// Runs one API call; toasts the outcome and refreshes the page data.
function useRunner() {
  const { enqueueSnackbar } = useSnackbar();
  const qc = useQueryClient();
  return async (call, done) => {
    try {
      const res = await call();
      if (!res.data?.success) throw new Error(res.data?.message || "Failed");
      enqueueSnackbar(done, { variant: "success" });
      qc.invalidateQueries({ queryKey: ["workSettings"] });
      return true;
    } catch (e) {
      enqueueSnackbar(msg(e), { variant: "error" });
      return false;
    }
  };
}

function ShiftEditor({ calendar, onClose }) {
  const run = useRunner();
  const [name, setName] = useState(calendar?.Name ?? "");
  const [isDefault, setIsDefault] = useState(Boolean(calendar?.IsDefault));
  const [days, setDays] = useState(() => seedDays(calendar?.DaysJson));
  const warnings = shiftWarnings(days);
  const patch = (d, change) => setDays((all) => all.map((x) => (x.d === d ? { ...x, ...change } : x)));

  const save = async () => {
    const DaysJson = days.map(({ d, on, start, end, breakStart, breakEnd }) => ({
      d, on, start, end, ...(breakStart && breakEnd ? { breakStart, breakEnd } : {}),
    }));
    const ok = await run(
      () => saveWorkCalendar({ Id: calendar?.Id ?? 0, Name: name, DaysJson, IsDefault: isDefault }),
      "Shift saved",
    );
    if (ok) onClose();
  };

  return (
    <Modal open onClose={onClose} size="xl">
      <Modal.Header title={calendar ? "Edit shift" : "New shift"} subtitle="All times are IST" onClose={onClose} />
      <Modal.Body>
        <Box sx={{ display: "grid", gap: 1.5 }}>
          <TextInput label="Shift name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. General" />
          <Checkbox label="Company default shift" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          {WEEK_ORDER.map((d) => {
            const x = days.find((r) => r.d === d);
            return (
              <Box key={d} sx={{ display: "grid", gridTemplateColumns: "110px 110px repeat(4, minmax(90px, 1fr))", gap: 1, alignItems: "end" }}>
                <Switch label={DAY_NAMES[d]} checked={x.on} onChange={(e) => patch(d, { on: e.target.checked })} />
                <span />
                {[["start", "Start"], ["end", "End"], ["breakStart", "Break start"], ["breakEnd", "Break end"]].map(([k, l]) => (
                  <TextInput
                    key={k} type="time" size="sm" disabled={!x.on}
                    aria-label={`${DAY_NAMES[d]} ${l}`} value={x[k] ?? ""}
                    onChange={(e) => patch(d, { [k]: e.target.value })}
                  />
                ))}
              </Box>
            );
          })}
          {warnings.length > 0 && (
            <Box role="status" data-testid="shift-warnings" sx={{ fontSize: 13 }}>
              {warnings.map((w) => <div key={w}>Warning: {w}</div>)}
            </Box>
          )}
        </Box>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={!name.trim()}>Save shift</Button>
      </Modal.Footer>
    </Modal>
  );
}

function ShiftsTab({ calendars, canEdit, confirmation, run }) {
  const [editing, setEditing] = useState(undefined); // undefined closed, null new, row edit
  return (
    <Box sx={{ display: "grid", gap: 1 }}>
      {canEdit && <div><Button onClick={() => setEditing(null)}>New shift</Button></div>}
      {calendars.map((c) => {
        const blocked = c.IsDefault ? "The default shift cannot be deleted" : c.UserCount > 0 ? `${c.UserCount} people use this shift` : "";
        return (
          <Box key={c.Id} sx={{ display: "flex", gap: 1.5, alignItems: "center" }}>
            <strong>{c.Name}</strong>
            {c.IsDefault ? <span>Default</span> : null}
            <span>{c.UserCount ?? 0} people</span>
            {canEdit && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>Edit {c.Name}</Button>
                <Tooltip title={blocked}>
                  <span>
                    <Button
                      variant="ghost" size="sm" disabled={Boolean(blocked)}
                      onClick={() => confirmation.confirmDelete({
                        title: "Delete shift", message: `Delete "${c.Name}"?`, confirmText: "Delete shift",
                        onConfirm: () => run(() => deleteWorkCalendar({ Id: c.Id }), "Shift deleted"),
                      })}
                    >
                      Delete {c.Name}
                    </Button>
                  </span>
                </Tooltip>
              </>
            )}
          </Box>
        );
      })}
      {editing !== undefined && <ShiftEditor calendar={editing} onClose={() => setEditing(undefined)} />}
    </Box>
  );
}

function HolidayEditor({ holiday, offices, onClose }) {
  const run = useRunner();
  const [date, setDate] = useState(dateOnly(holiday?.HolidayDate));
  const [name, setName] = useState(holiday?.Name ?? "");
  const [branch, setBranch] = useState(String(holiday?.BranchId ?? 0));
  const options = [{ value: "0", label: "All offices" }, ...offices.map((b) => ({ value: String(b.Id), label: b.BranchName }))];
  const save = async () => {
    const ok = await run(
      () => saveHoliday({ Id: holiday?.Id ?? 0, HolidayDate: date, Name: name, BranchId: Number(branch) || null }),
      "Holiday saved",
    );
    if (ok) onClose();
  };
  return (
    <Modal open onClose={onClose} size="sm">
      <Modal.Header title={holiday ? "Edit holiday" : "New holiday"} onClose={onClose} />
      <Modal.Body>
        <Box sx={{ display: "grid", gap: 1.5 }}>
          <DateField label="Holiday date" value={date} onChange={setDate} />
          <TextInput label="Holiday name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali" />
          <FormSelect label="Office" value={branch} onChange={(e) => setBranch(e.target.value)} options={options} placeholder="All offices" />
        </Box>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={!date || !name.trim()}>Save holiday</Button>
      </Modal.Footer>
    </Modal>
  );
}

function HolidaysTab({ holidays, offices, canEdit, confirmation, run }) {
  const [editing, setEditing] = useState(undefined);
  return (
    <Box sx={{ display: "grid", gap: 1 }}>
      {canEdit && <div><Button onClick={() => setEditing(null)}>New holiday</Button></div>}
      {holidays.length === 0 && <p>No holidays yet.</p>}
      {holidays.map((h) => (
        <Box key={h.Id} sx={{ display: "flex", gap: 1.5, alignItems: "center" }}>
          <span>{dateOnly(h.HolidayDate)}</span>
          <strong>{h.Name}</strong>
          <span>{h.BranchName || "All offices"}</span>
          {canEdit && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditing(h)}>Edit {h.Name}</Button>
              <Button
                variant="ghost" size="sm"
                onClick={() => confirmation.confirmDelete({
                  title: "Delete holiday", message: `Delete "${h.Name}"?`, confirmText: "Delete holiday",
                  onConfirm: () => run(() => deleteHoliday({ Id: h.Id }), "Holiday deleted"),
                })}
              >
                Delete {h.Name}
              </Button>
            </>
          )}
        </Box>
      ))}
      {editing !== undefined && <HolidayEditor holiday={editing} offices={offices} onClose={() => setEditing(undefined)} />}
    </Box>
  );
}

const hoursOf = (minutes) => (minutes == null ? "" : String(Math.round((minutes / 60) * 100) / 100));

function RulesTab({ settings, tatPolicy, canEdit, run }) {
  const s = settings ?? {};
  const [form, setForm] = useState({
    LateGraceMin: String(s.LateGraceMin ?? 10),
    SessionBufferMin: String(s.SessionBufferMin ?? 30),
    WarnPct: String(s.WarnPct ?? 80),
    NotifyNotSignedIn: Boolean(s.NotifyNotSignedIn),
    GoLiveDate: dateOnly(s.GoLiveDate),
  });
  const [tat, setTat] = useState(() =>
    Object.fromEntries(PRIORITIES.map((p) => [p, hoursOf(tatPolicy.find((t) => t.Priority === p)?.Minutes)])),
  );
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const num = (label, k, hint) => (
    <TextInput label={label} hint={hint} type="number" value={form[k]} onChange={set(k)} disabled={!canEdit} />
  );

  const save = async () => {
    const ok = await run(
      () => saveCompanySetting({
        LateGraceMin: Number(form.LateGraceMin), SessionBufferMin: Number(form.SessionBufferMin),
        WarnPct: Number(form.WarnPct), NotifyNotSignedIn: form.NotifyNotSignedIn, GoLiveDate: form.GoLiveDate || null,
      }),
      "Rules saved",
    );
    if (!ok) return;
    const Items = PRIORITIES.filter((p) => tat[p] !== "").map((p) => ({ Priority: p, Minutes: Math.round(Number(tat[p]) * 60) }));
    await run(() => saveTatPolicy({ Items }), "Task targets saved");
  };

  return (
    <Box sx={{ display: "grid", gap: 1.5, maxWidth: 480 }}>
      {num("Late grace (minutes)", "LateGraceMin")}
      {num("Session buffer (minutes)", "SessionBufferMin")}
      {num("Warning point (% of target)", "WarnPct")}
      <Switch
        label="Tell managers when someone has not signed in"
        checked={form.NotifyNotSignedIn} disabled={!canEdit}
        onChange={(e) => setForm((f) => ({ ...f, NotifyNotSignedIn: e.target.checked }))}
      />
      <DateField
        label="Go-live date" hint="Nothing is recorded before this date. Empty = off."
        value={form.GoLiveDate} disabled={!canEdit} onChange={(v) => setForm((f) => ({ ...f, GoLiveDate: v }))}
      />
      <h3>Task targets (hours)</h3>
      {PRIORITIES.map((p) => (
        <TextInput
          key={p} label={`${p[0].toUpperCase()}${p.slice(1)} priority (hours)`} type="number" step="0.25"
          value={tat[p]} disabled={!canEdit} onChange={(e) => setTat((t) => ({ ...t, [p]: e.target.value }))}
        />
      ))}
      {canEdit && <div><Button onClick={save}>Save rules</Button></div>}
    </Box>
  );
}

export default function WorkCalendar() {
  const [tab, setTab] = useState("shifts");
  const canEdit = useAccess("settings").edit;
  const confirmation = useConfirmation();
  const run = useRunner();
  const { data } = useApiQuery({
    queryKey: ["workSettings"], endpoint: WORK_ENDPOINTS.fetchWorkSettings, params: {}, staleTime: 0,
  });
  const { data: branchData } = useApiQuery({
    queryKey: ["branches"], endpoint: SALES_ENDPOINTS.users.fetchBranches, params: {}, showErrorMessage: false,
  });
  const offices = (branchData?.branches ?? []).filter((b) => b.IsActive !== false && b.IsActive !== 0);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <PageHeader title="Work calendar" subtitle="Shifts, holidays and the rules behind presence and task targets. All times are IST." />
      <Helmet><title>PRD Infotech | Work calendar</title></Helmet>
      <Box sx={{ mt: 1.5 }}><Tabs value={tab} onChange={setTab} items={TABS} data-testid="work-calendar-tabs" /></Box>
      <Box sx={{ mt: 2 }}>
        {!data ? null : tab === "shifts" ? (
          <ShiftsTab calendars={data.calendars ?? []} canEdit={canEdit} confirmation={confirmation} run={run} />
        ) : tab === "holidays" ? (
          <HolidaysTab holidays={data.holidays ?? []} offices={offices} canEdit={canEdit} confirmation={confirmation} run={run} />
        ) : (
          <RulesTab settings={data.settings} tatPolicy={data.tatPolicy ?? []} canEdit={canEdit} run={run} />
        )}
      </Box>
      <ConfirmationDialog
        open={confirmation.isOpen} onClose={confirmation.hideConfirmation} onConfirm={confirmation.handleConfirm}
        title={confirmation.confirmationState.title} message={confirmation.confirmationState.message}
        confirmText={confirmation.confirmationState.confirmText} cancelText={confirmation.confirmationState.cancelText}
        type={confirmation.confirmationState.type} icon={confirmation.confirmationState.icon}
        isLoading={confirmation.isLoading} maxWidth={confirmation.confirmationState.maxWidth}
      />
    </Box>
  );
}
