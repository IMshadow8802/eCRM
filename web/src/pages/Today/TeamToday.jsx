import { useState } from "react";
import dayjs from "dayjs";

import { Button, Chip, DateField } from "../../components/ui";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useIsAdmin } from "../../hooks/useAccess";
import useAuthStore from "../../stores/useAuthStore";
import { PRESENCE_ENDPOINTS } from "../../api/presenceQueries";
import { istShort, parseIst } from "../../utils/tatChip";
import DayMarkDialog from "./DayMarkDialog";
import SessionsDialog from "./SessionsDialog";

export const todayKey = () => dayjs().format("YYYY-MM-DD");

// Status words are the same for the person and their manager: label + optional "Late by n min".
export function StatusCell({ status }) {
  if (!status) return null;
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      <span>{status.label}</span>
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
        <table style={{ width: "100%", fontSize: 13 }} data-testid="team-table">
          <thead>
            <tr>
              {["Person", "Status", "Signed in", "Open", "At risk", "Over", "Reason pending", ""].map((h) => (
                <th key={h} align="left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.UserId} data-testid={`team-row-${r.UserId}`}>
                <td>{r.FullName}</td>
                <td><StatusCell status={r.status} /></td>
                <td>{signedIn(r.FirstSignInAt)}</td>
                <td>{r.Open ?? 0}</td>
                <td>{r.AtRisk ?? 0}</td>
                <td>{r.Over ?? 0}</td>
                <td>{r.ReasonPending ?? 0}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <Button size="sm" variant="ghost" onClick={() => setMark(r)} data-testid={`mark-day-${r.UserId}`}>Mark day</Button>
                  {isAdmin && Number(r.UserId) !== Number(me) && (
                    <Button size="sm" variant="ghost" onClick={() => setSessions(r)} data-testid={`sessions-${r.UserId}`}>Sessions</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {mark && <DayMarkDialog open person={mark} date={date} onClose={() => setMark(null)} />}
      {sessions && <SessionsDialog open person={sessions} onClose={() => setSessions(null)} />}
    </div>
  );
}
