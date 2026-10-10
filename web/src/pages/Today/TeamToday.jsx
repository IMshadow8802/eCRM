import { useState } from "react";
import dayjs from "dayjs";

import { Button, Chip, DateField, Tooltip } from "../../components/ui";
import { ReportTable } from "../Reports/ReportShell";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useIsAdmin } from "../../hooks/useAccess";
import useAuthStore from "../../stores/useAuthStore";
import { PRESENCE_ENDPOINTS } from "../../api/presenceQueries";
import { istShort, parseIst } from "../../utils/tatChip";
import DayMarkDialog from "./DayMarkDialog";
import SessionsDialog from "./SessionsDialog";

export const todayKey = () => dayjs().format("YYYY-MM-DD");

// The day mark as words: a full-day mark is the status itself; a half-day leave rides along the session status.
const HALF = { first_half: "first half", second_half: "second half" };
const markText = (status) => {
  if (status?.code === "leave") return "On leave";
  if (status?.code === "on_duty") return "On duty";
  return HALF[status?.half] ? `On leave · ${HALF[status.half]}` : null;
};

// Status words are the same for the person and their manager: label + day mark + optional "Late by n min".
const STATUS_HINT = {
  online: "Online: the app is open and active right now.",
  offline: "Offline: signed in today, but the app is closed or has been quiet for a while.",
  signed_out: "Signed out: the person signed out on purpose.",
  not_signed_in_yet: "Not signed in yet: work has not started yet, or the 'count as late after' minutes are still running. This is fine for now.",
  not_signed_in: "Not signed in: work time has started and the person has not signed in today.",
  leave: "On leave: a manager marked this day as leave.",
  on_duty: "On duty: working away from the office. Counts as present.",
  holiday: "Holiday: the company is closed today, so nobody is expected to sign in.",
};
const MARK_HINT = {
  leave: "On leave: a manager marked this day as leave.",
  on_duty: "On duty: working away from the office. Counts as present.",
  half: "Half-day leave: a manager marked the first or second half of this day as leave.",
};
// Hover or keyboard focus explains the word; the word itself is unchanged.
const Tip = ({ title, children }) => (
  <Tooltip title={title}><span tabIndex={0}>{children}</span></Tooltip>
);

export function StatusCell({ status }) {
  if (!status) return null;
  const mark = markText(status);
  const markOnly = status.code === "leave" || status.code === "on_duty";
  return (
    <span style={{ display: "inline-flex", gap: "calc(6rem / 15)", flexWrap: "wrap", alignItems: "center" }}>
      {!markOnly && <Tip title={STATUS_HINT[status.code]}><span>{status.label}</span></Tip>}
      {mark && (
        <Tip title={MARK_HINT[status.code] ?? MARK_HINT.half}>
          <Chip size="sm" tone={status.code === "on_duty" ? "info" : "accent"} variant="tonal" label={mark} />
        </Tip>
      )}
      {status.late && (
        <Tip title="Late: signed in after the 'count as late after' minutes that start when the shift starts.">
          <Chip size="sm" tone="warning" variant="tonal" label={status.late} />
        </Tip>
      )}
    </span>
  );
}

const th = (header, hint) => (
  <Tooltip title={hint}><span tabIndex={0} style={{ cursor: "help", textDecoration: "underline dotted" }}>{header}</span></Tooltip>
);

export const signedIn = (v) => (v ? istShort(v, parseIst(v)) : "—");

export default function TeamToday() {
  const [date, setDate] = useState(todayKey);
  const [mark, setMark] = useState(null);
  const [sessions, setSessions] = useState(null);
  const isAdmin = useIsAdmin();
  const me = useAuthStore((s) => s.user?.UserId ?? s.UserId);
  const { data, isLoading } = useApiQuery({
    queryKey: ["today", "team", date],
    endpoint: PRESENCE_ENDPOINTS.fetchTeamToday,
    params: { WorkDate: date },
    enabled: Boolean(date),
    staleTime: 30000,
    showErrorMessage: false,
  });
  const rows = data?.team ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "calc(12rem / 15)" }}>
      <div style={{ maxWidth: "calc(200rem / 15)" }}>
        <DateField label="Day" value={date} onChange={(v) => v && setDate(v)} data-testid="team-day" />
      </div>
      {!isLoading && rows.length === 0 ? (
        <p>No one to show for this day.</p>
      ) : (
        <ReportTable
          testId="team-table"
          rows={rows}
          rowKey={(r) => r.UserId}
          rowTestId={(r) => `team-row-${r.UserId}`}
          columns={[
            { header: "Person", key: "person", cell: (r) => r.FullName },
            { header: th("Status", "Whether the person is at work today: online, offline, on leave and so on. Hover a status to see what it means."), key: "status", cell: (r) => <StatusCell status={r.status} /> },
            { header: th("Signed in", "The time the person first signed in today (IST)."), key: "signedin", cell: (r) => signedIn(r.FirstSignInAt) },
            { header: th("Tasks running", "Tasks that have a deadline running and are not finished yet."), key: "open", align: "right", cell: (r) => r.Open ?? 0 },
            { header: th("Close to deadline", "Open tasks where most of the allowed time is used up. They will miss the deadline if not finished soon."), key: "atrisk", align: "right", cell: (r) => r.AtRisk ?? 0 },
            { header: th("Past deadline", "Tasks that have already gone past their deadline."), key: "over", align: "right", cell: (r) => r.Over ?? 0 },
            { header: th("Waiting for reason", "Tasks that missed the deadline where the person has not yet said why."), key: "reason", align: "right", cell: (r) => r.ReasonPending ?? 0 },
            {
              header: "Actions",
              key: "actions",
              cell: (r) => (
                <span style={{ display: "inline-flex", gap: "calc(6rem / 15)", whiteSpace: "nowrap" }}>
                  <Tooltip title="Record leave (full or half day) or working away from office (on duty) for this person on the chosen day. Past days are fine.">
                    <span><Button size="sm" variant="outlined" onClick={() => setMark(r)} data-testid={`mark-day-${r.UserId}`}>Leave / on duty</Button></span>
                  </Tooltip>
                  {isAdmin && Number(r.UserId) !== Number(me) && (
                    <Tooltip title="Admin only: see this person's sign-in history and sign them out everywhere, for example if a phone is lost.">
                      <span><Button size="sm" variant="outlined" onClick={() => setSessions(r)} data-testid={`sessions-${r.UserId}`}>Sign-ins</Button></span>
                    </Tooltip>
                  )}
                </span>
              ),
            },
          ]}
        />
      )}
      {mark && <DayMarkDialog open person={mark} date={date} onClose={() => setMark(null)} />}
      {sessions && <SessionsDialog open person={sessions} onClose={() => setSessions(null)} />}
    </div>
  );
}
