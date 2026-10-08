import { useState } from "react";
import dayjs from "dayjs";

import { Button, Chip, DateField } from "../../components/ui";
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
export function StatusCell({ status }) {
  if (!status) return null;
  const mark = markText(status);
  const markOnly = status.code === "leave" || status.code === "on_duty";
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {!markOnly && <span>{status.label}</span>}
      {mark && <Chip size="sm" tone={status.code === "on_duty" ? "info" : "accent"} variant="tonal" label={mark} />}
      {status.late && <Chip size="sm" tone="warning" variant="tonal" label={status.late} />}
    </span>
  );
}

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
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ maxWidth: 200 }}>
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
            { header: "Person", cell: (r) => r.FullName },
            { header: "Status", cell: (r) => <StatusCell status={r.status} /> },
            { header: "Signed in", cell: (r) => signedIn(r.FirstSignInAt) },
            { header: "Open", align: "right", cell: (r) => r.Open ?? 0 },
            { header: "At risk", align: "right", cell: (r) => r.AtRisk ?? 0 },
            { header: "Over", align: "right", cell: (r) => r.Over ?? 0 },
            { header: "Reason pending", align: "right", cell: (r) => r.ReasonPending ?? 0 },
            {
              header: "Actions",
              key: "actions",
              cell: (r) => (
                <span style={{ display: "inline-flex", gap: 6, whiteSpace: "nowrap" }}>
                  <Button size="sm" variant="outlined" onClick={() => setMark(r)} data-testid={`mark-day-${r.UserId}`}>Mark day</Button>
                  {isAdmin && Number(r.UserId) !== Number(me) && (
                    <Button size="sm" variant="outlined" onClick={() => setSessions(r)} data-testid={`sessions-${r.UserId}`}>Sessions</Button>
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
