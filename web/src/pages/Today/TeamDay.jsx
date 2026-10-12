import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { AlertCircle } from "lucide-react";
import { useTheme } from "@mui/material/styles";
import dayjs from "dayjs";

import { Button, Chip, DateField, EmptyState, Skeleton } from "../../components/ui";
import { ReportTable } from "../Reports/ReportShell";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useIsAdmin } from "../../hooks/useAccess";
import { TODAY } from "../../api/todayQueries";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { LIVE_BUCKETS, LIVE_TILES, NUMBERS, TILES, durationText, hhmm, numberLabel } from "./todayWords";
import PersonCard, { Actions, Count, StatusPill } from "./PersonCard";
import TeamTiles from "./TeamTiles";
import PersonTasksDrawer from "./PersonTasksDrawer";
import DayMarkDialog from "./DayMarkDialog";
import SessionsDialog from "./SessionsDialog";

const VIEW_KEY = "today.teamView";
const readView = () => { try { return localStorage.getItem(VIEW_KEY); } catch { return null; } };
const saveView = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* private window: the switch still works for this visit */ } };

/**
 * Today → My team (spec §2.2): everyone in reach, the caller first.
 * `dayTarget` is the tab row's right end (Today.jsx): the Day picker portals
 * there; without one (rendered alone) it sits at the end of the Showing row.
 */
export default function TeamDay({ dayTarget = null }) {
  const p = useTheme().tokens;
  const [params, setParams] = useSearchParams();
  const today = dayjs().format("YYYY-MM-DD");
  const asked = params.get("day");
  // The round-trip rejects dates that match the pattern but do not exist (2026-02-30).
  const day = /^\d{4}-\d{2}-\d{2}$/.test(asked ?? "") && dayjs(asked).format("YYYY-MM-DD") === asked && asked <= today ? asked : today;
  const [tile, setTile] = useState(null);
  const [view, setView] = useState(readView);
  const [drawer, setDrawer] = useState(null);
  const [mark, setMark] = useState(null);
  const [sessions, setSessions] = useState(null);
  const isAdmin = useIsAdmin();

  const { data, isLoading, isError, refetch } = useApiQuery({
    queryKey: ["today", "team", day],
    endpoint: TODAY.team,
    params: { WorkDate: day },
    staleTime: 30000,
    showErrorMessage: false,
  });
  const { data: branchData } = useApiQuery({ queryKey: ["branches"], endpoint: SALES_ENDPOINTS.users.fetchBranches, showErrorMessage: false });
  const offices = useMemo(() => new Map((branchData?.branches ?? []).map((b) => [b.Id, b.BranchName])), [branchData]);

  const people = data?.people ?? [];
  const live = data?.day?.live !== false;
  // A live tile means nothing on a past day: drop the pick rather than filter everyone out behind a disabled tile.
  const activeTile = !live && LIVE_TILES.has(tile) ? null : tile;
  const test = TILES.find((t) => t.key === activeTile)?.test;
  const shown = test ? people.filter(test) : people;
  const mode = view ?? (people.length > 24 ? "table" : "cards");
  const others = people.filter((x) => !x.isMe).length;

  const pickDay = (v) => v && setParams((prev) => { prev.set("day", v); return prev; });
  const pickView = (v) => { setView(v); saveView(v); };
  // A past day has no live state, so a live bucket is never asked for.
  const open = (person, bucket) => (live || !LIVE_BUCKETS.has(bucket)) && setDrawer({ person, bucket });
  const shared = { live, onOpen: open, onMark: setMark, onSessions: setSessions, canSessions: isAdmin };

  const columns = [
    { header: "Person", key: "person", cell: (r) => <span style={{ display: "inline-flex", gap: "calc(6rem / 15)", alignItems: "center", whiteSpace: "nowrap" }}>{r.FullName}{r.isMe && <Chip size="sm" tone="primary" label="You" />}</span> },
    { header: "Status", key: "status", cell: (r) => <StatusPill person={r} /> },
    { header: "Signed in", key: "signedin", cell: (r) => (r.FirstSignInAt ? hhmm(r.FirstSignInAt) : "—") },
    { header: "Online", key: "online", cell: (r) => (r.session ? durationText(r.session.onlineMinutes) : "—") },
    ...NUMBERS.map(({ key, tone }) => ({ header: numberLabel(key, live), key: `n_${key}`, align: "right", cell: (r) => <Count person={r} k={key} tone={tone} live={live} onOpen={open} /> })),
    { header: "Actions", key: "actions", size: 260, cell: (r) => <Actions nowrap person={r} canSessions={isAdmin} onMark={setMark} onSessions={setSessions} /> },
  ];

  const seg = (v, label) => (
    <button type="button" aria-pressed={mode === v} onClick={() => pickView(v)}
      style={{ padding: "calc(6rem / 15) calc(12rem / 15)", borderRadius: "calc(8rem / 15)", border: 0, fontFamily: "inherit", fontWeight: 600, fontSize: "calc(13rem / 15)", cursor: "pointer", background: mode === v ? p.surface.card : "transparent", color: mode === v ? p.text.primary : p.text.secondary }}>
      {label}
    </button>
  );

  const dayPicker = <DateField inlineLabel label="Day" size="sm" value={day} maxDate={today} onChange={pickDay} data-testid="team-day" />;

  let body;
  if (isLoading) body = <Skeleton variant="rect" height={240} />;
  else if (isError) body = <EmptyState icon={<AlertCircle />} title="Couldn't load your team" description="Check your connection and try again." action={<Button onClick={() => refetch()}>Retry</Button>} />;
  else if (people.length === 0) body = <p>No one to show for this day.</p>;
  else if (shown.length === 0) body = <EmptyState size="sm" title="No one matches this tile" action={<Button variant="secondary" onClick={() => setTile(null)}>Clear</Button>} />;
  else if (mode === "table") body = <ReportTable testId="team-table" rows={shown} columns={columns} rowKey={(r) => r.UserId} rowTestId={(r) => `team-row-${r.UserId}`} />;
  else body = (
    // min(100%, …) lets one column shrink to a 390px phone instead of overflowing it.
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, calc(340rem / 15)), 1fr))", gap: "calc(12rem / 15)", minWidth: 0 }}>
      {shown.map((x) => <PersonCard key={x.UserId} person={x} office={offices.get(x.BranchId)} {...shared} />)}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "calc(12rem / 15)", minWidth: 0 }}>
      {dayTarget && createPortal(dayPicker, dayTarget)}
      <TeamTiles people={people} live={live} active={activeTile} onPick={setTile} />

      <div style={{ display: "flex", alignItems: "center", gap: "calc(10rem / 15)", flexWrap: "wrap" }}>
        <span style={{ fontSize: "calc(13rem / 15)", fontWeight: 600, color: p.text.secondary }}>Showing</span>
        <span data-testid="showing"><Chip size="sm" tone="primary" label={`${TILES.find((t) => t.key === activeTile)?.label ?? "Everyone"} · ${shown.length}`} /></span>
        <span style={{ fontSize: "calc(13rem / 15)", color: p.text.secondary, fontWeight: 500 }}>
          {`of ${others} ${others === 1 ? "person" : "people"} in your team, most urgent first`}
        </span>
        <span style={{ fontSize: "calc(13rem / 15)", color: live ? p.text.tertiary : p.warning.hover, fontWeight: live ? 400 : 600 }}>
          {live ? "Click a tile or any number to narrow down." : "Live counts only for today"}
        </span>
        {!dayTarget && dayPicker}
        <div style={{ marginLeft: "auto", display: "flex", gap: "calc(4rem / 15)", padding: "calc(4rem / 15)", background: p.surface.subtle, borderRadius: "calc(10rem / 15)" }}>
          {seg("cards", "Cards")}
          {seg("table", "Table")}
        </div>
      </div>

      {body}

      {drawer && (
        <PersonTasksDrawer open userId={drawer.person.UserId} name={drawer.person.FullName} workDate={day} bucket={drawer.bucket} live={live} onClose={() => setDrawer(null)} />
      )}
      {mark && <DayMarkDialog open person={mark} date={day} onClose={() => setMark(null)} />}
      {sessions && <SessionsDialog open person={sessions} date={live ? undefined : day} onClose={() => setSessions(null)} />}
    </div>
  );
}
