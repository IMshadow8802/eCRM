import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CalendarClock } from "lucide-react";

import { Button, PageHeader, Tabs, Tooltip } from "../../components/ui";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";
import TatChip from "../../components/Kanban/TatChip";
import BreachReasonDialog from "../Task/Components/TaskDetail/BreachReasonDialog";
import { useApiQuery } from "../../hooks/useApiQuery";
import { PRESENCE_ENDPOINTS } from "../../api/presenceQueries";
import { parseIst } from "../../utils/tatChip";
import TeamToday, { StatusCell, signedIn, todayKey } from "./TeamToday";

// A clock row shaped as the task fields TatChip reads.
const asTask = (c) => ({
  Id: c.TaskId, TatDueAt: c.DueAt, TatWarnAt: c.WarnedAt, TatBreachedAt: c.BreachedAt,
  TatHeldSince: c.HeldSince, TatHoldReason: c.HoldReason,
});

function Mine() {
  const navigate = useNavigate();
  const [reason, setReason] = useState(null);
  const { data } = useApiQuery({
    queryKey: ["tasks", "today", "mine"], // ["tasks"] prefix: realtime + the reason dialog refresh it
    endpoint: PRESENCE_ENDPOINTS.fetchToday,
    staleTime: 30000,
    showErrorMessage: false,
  });
  const presence = Array.isArray(data?.presence) ? data.presence[0] : data?.presence;
  const clocks = [...(data?.clocks ?? [])].sort((a, b) => (a.DueAt ? parseIst(a.DueAt) : Infinity) - (b.DueAt ? parseIst(b.DueAt) : Infinity) || 0);
  const pending = data?.reasonPending ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "calc(20rem / 15)" }}>
      <div data-testid="today-signin">
        {presence?.FirstSignInAt && <div>{`Signed in at ${signedIn(presence.FirstSignInAt)}`}</div>}
        <StatusCell status={presence?.status} />
      </div>

      <section>
        <h3>Open tasks</h3>
        {clocks.length === 0 ? <p>Nothing due.</p> : clocks.map((c) => (
          <div key={c.TatId} data-testid={`clock-${c.TatId}`} style={{ display: "flex", gap: "calc(12rem / 15)", alignItems: "center", paddingBlock: "calc(6rem / 15)" }}>
            <Button variant="ghost" onClick={() => navigate(`/tasks?taskId=${c.TaskId}`)}>{c.TaskTitle}</Button>
            <TatChip task={asTask(c)} />
          </div>
        ))}
      </section>

      {pending.length > 0 && (
        <section>
          <h3>Missed deadline – say why</h3>
          {pending.map((c) => (
            <div key={c.TatId} data-testid={`pending-${c.TatId}`} style={{ display: "flex", gap: "calc(12rem / 15)", alignItems: "center", paddingBlock: "calc(6rem / 15)" }}>
              <span>{c.TaskTitle}</span>
              <Tooltip title="This task missed its deadline. Say why it was late so your manager can decide."><span><Button size="sm" variant="secondary" onClick={() => setReason(c)}>Explain delay</Button></span></Tooltip>
            </div>
          ))}
        </section>
      )}
      {reason && <BreachReasonDialog open tatId={reason.TatId} taskId={reason.TaskId} onClose={() => setReason(null)} />}
    </div>
  );
}

export default function Today() {
  const [params, setParams] = useSearchParams();
  // The team tab exists only when the caller has someone to manage.
  const { data } = useApiQuery({
    queryKey: ["today", "team", todayKey()],
    endpoint: PRESENCE_ENDPOINTS.fetchTeamToday,
    params: { WorkDate: todayKey() },
    staleTime: 30000,
    showErrorMessage: false,
  });
  const hasTeam = (data?.team?.length ?? 0) > 0;
  const tab = hasTeam && params.get("tab") === "team" ? "team" : "mine";
  const items = [{ value: "mine", label: "Mine" }, ...(hasTeam ? [{ value: "team", label: "My team" }] : [])];

  return (
    <div style={{ paddingBlock: "calc(8rem / 15)", display: "flex", flexDirection: "column", gap: "calc(16rem / 15)" }}>
      <PageHeader title="Today" icon={<CalendarClock size={22} />} actions={<HelpGuide guide={HELP_GUIDES.today} />} />
      {hasTeam && <Tabs value={tab} onChange={(v) => setParams({ tab: v })} items={items} data-testid="today-tabs" />}
      {tab === "team" ? <TeamToday /> : <Mine />}
    </div>
  );
}
