import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, Check, CalendarOff, CalendarClock, CircleCheck, CircleDashed, CirclePlay, Clock, ListTodo, LogIn, Wifi } from "lucide-react";
import { useTheme } from "@mui/material/styles";

import { Button, Chip, EmptyState, IconBadge, Progress, Skeleton } from "../../components/ui";
import BreachReasonDialog from "../Task/Components/TaskDetail/BreachReasonDialog";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { TODAY } from "../../api/todayQueries";
import { TAT_ENDPOINTS } from "../../api/tatQueries";
import { durationText, hhmm, taskChip } from "./todayWords";
import { rowClick } from "../../utils/rowClick";

const TONE = { red: "error", amber: "warning", blue: "info", green: "success", grey: "default" };
const LIVE_ONLY = "Live counts only for today";
const IST = (opts) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", ...opts });
const DATE = IST({ weekday: "long", day: "numeric", month: "long" });
const HOUR = IST({ hour: "numeric", hourCycle: "h23" });

function greeting(name) {
  const h = Number(HOUR.format(new Date()));
  const part = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
  return `Good ${part}${name ? `, ${name.split(" ")[0]}` : ""}`;
}

// Most urgent first: a reason owed, then overdue, then close to deadline; least time left first within each.
const rank = (t) => (t.flags.reasonOwed ? 0 : t.flags.overdue ? 1 : 2);
const left = (t) => t.timeLeftMin ?? Infinity;
const byUrgency = (a, b) => rank(a) - rank(b) || left(a) - left(b);

const TaskChip = ({ task }) => {
  const c = taskChip(task);
  return <Chip size="sm" label={c.label} tone={TONE[c.tone]} />;
};

function TaskTitle({ task, p, muted }) {
  return (
    <Link to={`/tasks?taskId=${task.TaskId}`} style={{ color: muted ? p.text.secondary : p.text.primary, fontWeight: muted ? 500 : 600, minWidth: 0, overflowWrap: "anywhere" }}>
      {task.Title}
    </Link>
  );
}

const where = (t, ...more) => [t.WorkspaceName, t.AssignedByName && `given by ${t.AssignedByName}`, ...more].filter(Boolean).join(" · ");
const stepsText = (t) => (t.StepsTotal > 0 ? `${t.StepsDone} of ${t.StepsTotal} steps` : null);

// A section: a tinted icon badge + title + a count pill in the same hue.
function Panel({ title, count, hint, tone = "primary", icon, testId, children, p }) {
  const danger = tone === "error";
  return (
    <section data-testid={testId} className="nx-raised" style={{ background: p.surface.card, border: `1px solid ${p.border.default}`, borderRadius: "calc(12rem / 15)", overflow: "hidden", minWidth: 0 }}>
      <div style={{ padding: "calc(10rem / 15) calc(16rem / 15)", display: "flex", alignItems: "center", gap: "calc(8rem / 15)", flexWrap: "wrap", borderBottom: `1px solid ${p.border.subtle}` }}>
        {icon && <IconBadge icon={icon} tone={tone} size="sm" />}
        <h2 style={{ margin: 0, fontSize: "calc(16rem / 15)", fontWeight: 700, color: danger ? p.error.hover : p.text.primary }}>{title}</h2>
        {count != null && <Chip size="sm" label={String(count)} tone={count > 0 ? tone : "default"} />}
        {hint && <span style={{ marginLeft: "auto", fontSize: "calc(12rem / 15)", color: danger ? p.error.hover : p.text.secondary, fontWeight: danger ? 600 : 400 }}>{hint}</span>}
      </div>
      {children}
    </section>
  );
}

const rowStyle = (p) => ({ padding: "calc(10rem / 15) calc(16rem / 15)", display: "flex", alignItems: "center", gap: "calc(12rem / 15)", flexWrap: "wrap", borderBottom: `1px solid ${p.border.subtle}` });
const sub = (p) => ({ fontSize: "calc(12rem / 15)", color: p.text.secondary });
const grow = { display: "flex", flexDirection: "column", gap: "calc(4rem / 15)", flex: "1 1 calc(200rem / 15)", minWidth: 0 };
const Empty = ({ text, p }) => <div style={{ padding: "calc(12rem / 15) calc(16rem / 15)", color: p.text.secondary }}>{text}</div>;

// A row opens its task (the title link stays the keyboard path).
function List({ tasks, empty, p, render }) {
  const navigate = useNavigate();
  return tasks.length === 0 ? <Empty text={empty} p={p} /> : tasks.map((t) => (
    <div key={t.TaskId} data-testid={`row-${t.TaskId}`} className="nx-clickable" onClick={rowClick(() => navigate(`/tasks?taskId=${t.TaskId}`))} style={rowStyle(p)}>{render(t)}</div>
  ));
}

function Cell({ label, icon, tone, value, chip, note, testId, p }) {
  return (
    <div style={{ padding: "calc(12rem / 15) calc(16rem / 15)", display: "flex", flexDirection: "column", gap: "calc(4rem / 15)", borderRight: `1px solid ${p.border.subtle}`, borderBottom: `1px solid ${p.border.subtle}`, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "calc(8rem / 15)", fontSize: "calc(13rem / 15)", fontWeight: 600, color: p.text.secondary }}>
        <IconBadge icon={icon} tone={tone} size="sm" />
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "calc(8rem / 15)", flexWrap: "wrap" }}>
        <span data-testid={testId} style={{ fontSize: "calc(22rem / 15)", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: value === 0 ? p.text.tertiary : p.text.primary }}>{value}</span>
        {chip}
      </div>
      <div style={sub(p)}>{note}</div>
    </div>
  );
}

function Strip({ me, live, done, p }) {
  const { status = {}, session, counts = {} } = me;
  const away = ["leave", "on_duty", "holiday", "not_tracked"].includes(status.code);
  const late = status.late ? (me.LateMinutes > 0 ? `Late ${durationText(me.LateMinutes)}` : status.late) : null;
  const n = session?.signIns ?? 0;
  const devices = session?.devices?.length ? ` (${session.devices.join(", ")})` : "";
  const doneLate = done.filter((t) => t.flags.doneLate).length;
  const noTimer = done.filter((t) => !t.flags.doneLate && t.timer === "none").length;
  const doneNote = done.length === 0 ? "None yet" : [`${done.length - doneLate - noTimer} on time`, `${doneLate} late`, noTimer && `${noTimer} no timer`].filter(Boolean).join(" · ");

  return (
    <div data-testid="my-strip" className="nx-raised" style={{ background: p.surface.card, border: `1px solid ${p.border.default}`, borderRadius: "calc(12rem / 15)", overflow: "hidden", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, calc(150rem / 15)), 1fr))" }}>
      <Cell p={p} label="Shift" icon={Clock} tone="primary" value={me.ShiftStart && me.ShiftEnd ? `${hhmm(me.ShiftStart)}–${hhmm(me.ShiftEnd)}` : "No shift"}
        note={away ? status.label : status.half ? `Leave · ${status.half.replace("_", " ")}` : "Your hours today"} />
      <Cell p={p} label="Signed in" icon={LogIn} tone="info" value={me.FirstSignInAt ? hhmm(me.FirstSignInAt) : "—"}
        chip={late && <Chip size="sm" label={late} tone="warning" />}
        note={me.SignedOutAt && !session?.open ? `Signed out ${hhmm(me.SignedOutAt)}` : me.FirstSignInAt ? `${n} sign-in${n === 1 ? "" : "s"}${devices}` : status.label} />
      <Cell p={p} label="Online today" icon={Wifi} tone="success" value={durationText(session?.onlineMinutes ?? 0)}
        chip={status.code === "online" || status.online ? <Chip size="sm" label="Online" tone="success" /> : <Chip size="sm" label="Offline" />}
        note={session?.lastSeenAt ? `Last active ${hhmm(session.lastSeenAt)}` : "Not active yet"} />
      <Cell p={p} testId="strip-done" label="Done today" icon={CircleCheck} tone="success" value={counts.done ?? done.length} note={doneNote} />
      <Cell p={p} testId="strip-open" label="Open tasks" icon={ListTodo} tone="violet" value={live ? counts.open ?? 0 : "—"}
        note={live ? `${counts.working ?? 0} working on · ${counts.notStarted ?? 0} not started` : LIVE_ONLY} />
    </div>
  );
}

/** Today → Mine (spec §2.1): the caller's own day, from /api/today/mine. */
export default function MyDay() {
  const p = useTheme().tokens;
  const navigate = useNavigate();
  const [reason, setReason] = useState(null);
  const { data, isLoading, isError, refetch } = useApiQuery({
    queryKey: ["tasks", "today", "mine"], // ["tasks"] prefix: the reason dialog and Accept refresh it
    endpoint: TODAY.mine,
    staleTime: 30000,
  });
  const accept = useApiMutation({ endpoint: TAT_ENDPOINTS.acknowledge, successMessage: "Task accepted", invalidateQueries: [["tasks"]] });

  if (isLoading) return <Skeleton variant="rect" height={240} />;
  if (isError) return <EmptyState data-testid="my-day-error" icon={<AlertCircle />} title="Couldn't load your day" description="Check your connection and try again." action={<Button onClick={() => refetch()}>Retry</Button>} />;
  const me = data?.me;
  if (!me) return <EmptyState data-testid="my-day-empty" icon={<CalendarOff />} title="No day to show" description="Your account has no work day today. Ask an admin if this looks wrong." />;

  const live = data.day?.live !== false;
  const tasks = me.tasks ?? [];
  const pick = (k) => tasks.filter((t) => t.flags?.[k]);
  const done = pick("done");
  // A reason owed outlives the finish (backend reasonOwed does not require open), so done tasks are not filtered out.
  const needs = live ? tasks.filter((t) => t.flags.reasonOwed || t.flags.overdue || t.flags.atRisk).sort(byUrgency) : [];
  const dateLine = data.day?.key ? DATE.format(new Date(`${data.day.key}T12:00:00+05:30`)) : "";
  const needLine = !live ? LIVE_ONLY : needs.length ? `${needs.length} thing${needs.length === 1 ? "" : "s"} need${needs.length === 1 ? "s" : ""} you now` : "Nothing needs you right now";
  const twoCol = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, calc(380rem / 15)), 1fr))", gap: "calc(12rem / 15)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "calc(12rem / 15)" }}>
      {/* One line, not a second page title: the bar already says "Today" (the page's h1). */}
      <div style={{ display: "flex", alignItems: "baseline", columnGap: "calc(10rem / 15)", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "calc(18rem / 15)", fontWeight: 700, letterSpacing: "-0.015em", color: p.text.primary }}>{greeting(me.FullName)}</h2>
        <div style={{ color: p.text.secondary, fontWeight: 500, fontSize: "calc(13rem / 15)" }}>{[dateLine, needLine].filter(Boolean).join(" · ")}</div>
      </div>

      <Strip me={me} live={live} done={done} p={p} />

      {needs.length > 0 && (
        <Panel p={p} testId="needs-now" title="Needs you now" hint="Most urgent first" tone="error" icon={AlertCircle}>
          <List p={p} tasks={needs} render={(t) => (
            <>
              <div style={grow}><TaskTitle task={t} p={p} /><span style={sub(p)}>{where(t)}</span></div>
              <TaskChip task={t} />
              <span style={{ fontSize: "calc(13rem / 15)", color: p.text.secondary, fontWeight: 500, minWidth: "calc(130rem / 15)" }}>
                {t.flags.reasonOwed ? "Tell your manager why" : t.StepsTotal > 0 ? `Steps ${t.StepsDone} of ${t.StepsTotal} done` : ""}
              </span>
              {t.flags.reasonOwed
                ? <Button size="sm" variant="destructive" onClick={() => setReason(t)}>Explain delay</Button>
                : <Button size="sm" variant="secondary" onClick={() => navigate(`/tasks?taskId=${t.TaskId}`)}>Open task</Button>}
            </>
          )} />
        </Panel>
      )}

      {live ? (
        <>
          <div style={twoCol}>
            <Panel p={p} testId="due-today" title="Due today" count={pick("dueToday").length} tone="warning" icon={CalendarClock}>
              <List p={p} tasks={pick("dueToday")} empty="Nothing due today." render={(t) => (
                <>
                  <span style={{ fontWeight: 700, color: p.text.primary, minWidth: "calc(48rem / 15)" }}>{t.due ? hhmm(t.due) : "—"}</span>
                  <div style={grow}>
                    <TaskTitle task={t} p={p} />
                    {t.StepsTotal > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: "calc(8rem / 15)" }}>
                        <div style={{ flex: 1 }}><Progress size="sm" value={(t.StepsDone / t.StepsTotal) * 100} /></div>
                        <span style={{ ...sub(p), fontWeight: 600 }}>{`${t.StepsDone} / ${t.StepsTotal}`}</span>
                      </div>
                    )}
                  </div>
                  <TaskChip task={t} />
                </>
              )} />
            </Panel>
            <Panel p={p} testId="working-on" title="Working on" count={pick("working").length} tone="info" icon={CirclePlay} hint="Accepted, or at least one step ticked">
              <List p={p} tasks={pick("working")} empty="Nothing in progress." render={(t) => (
                <>
                  <div style={grow}><TaskTitle task={t} p={p} /><span style={sub(p)}>{[t.WorkspaceName, stepsText(t)].filter(Boolean).join(" · ")}</span></div>
                  <TaskChip task={t} />
                </>
              )} />
            </Panel>
          </div>
          <div style={twoCol}>
            <Panel p={p} testId="not-started" title="Not started" count={pick("notStarted").length} tone="violet" icon={CircleDashed}>
              <List p={p} tasks={pick("notStarted")} empty="Nothing waiting to start." render={(t) => (
                <>
                  <div style={grow}><TaskTitle task={t} p={p} /><span style={sub(p)}>{where(t)}</span></div>
                  <span style={{ fontSize: "calc(13rem / 15)", color: p.text.secondary, fontWeight: 500 }}>{taskChip(t).label}</span>
                  {t.TatId && (
                    <Button size="sm" variant="tonal" loading={accept.isPending && accept.variables?.TaskId === t.TaskId}
                      onClick={() => accept.mutate({ TaskId: t.TaskId, TatId: t.TatId })}>Accept</Button>
                  )}
                </>
              )} />
            </Panel>
            <DonePanel p={p} done={done} />
          </div>
        </>
      ) : (
        <>
          <Empty p={p} text={LIVE_ONLY} />
          <DonePanel p={p} done={done} />
        </>
      )}

      {reason && <BreachReasonDialog open tatId={reason.TatId} taskId={reason.TaskId} onClose={() => setReason(null)} />}
    </div>
  );
}

function DonePanel({ done, p }) {
  return (
    <Panel p={p} testId="done-today" title="Done today" count={done.length} tone="success" icon={CircleCheck}>
      <List p={p} tasks={done} empty="Nothing finished yet." render={(t) => (
        <>
          <Check size={18} color={p.success.main} aria-hidden />
          <div style={grow}><TaskTitle task={t} p={p} muted /></div>
          <TaskChip task={t} />
        </>
      )} />
    </Panel>
  );
}
