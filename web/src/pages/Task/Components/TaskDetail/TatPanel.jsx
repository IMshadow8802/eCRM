import { useState } from "react";
import { Timer } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";

import { Button, Card, Chip, Combobox, EmptyState, Skeleton, TextArea, Tooltip } from "../../../../components/ui";
import { useApiQuery } from "../../../../hooks/useApiQuery";
import { useLookups } from "../../../../hooks/useLookups";
import { apiClient } from "../../../../utils/axiosConfig";
import { TAT_ENDPOINTS } from "../../../../api/tatQueries";
import { istStamp, overBy, eventText, VERDICT_LABEL } from "../../../../utils/tatChip";
import HelpGuide from "../../../../components/HelpGuide";
import { HELP_GUIDES } from "../../../../data/helpGuides";
import BreachReasonDialog from "./BreachReasonDialog";

const HINT = {
  holdAll: "Pause everyone's timers on this task. Use it when the whole task is waiting.",
  releaseAll: "Resume everyone's paused timers.",
  ack: "Tell your manager you have seen this task and will do it.",
  hold: "Pause your timer because you are waiting on something (the client, for example). Time on hold is not counted.",
  release: "Resume your paused timer.",
  mine: "Finish your own part because your part is finished. The task stays open for the others.",
  reason: "This missed its deadline. Write why it was late.",
  excused: "Accept the delay. A remark is needed.",
  notExcused: "Reject the delay. It stays against the deadline.",
  Running: "Running: the timer is ticking during working hours.",
  "Missed deadline": "Missed deadline: the deadline passed before the work was finished.",
  "On hold": "On hold: the timer is paused and does not count time.",
  Done: "Done: the work is finished and the timer has stopped.",
};
const Tip = ({ k, tab, children }) => <Tooltip title={HINT[k]}><span tabIndex={tab ? 0 : undefined}>{children}</span></Tooltip>;

const CLOSE_LABEL = {
  completed: "Done",
  my_part_done: "My part done",
  unassigned: "Unassigned",
  deleted: "Deleted",
  user_left: "Left the company",
  no_clock: "No deadline",
};
const STEP_HINT = {
  Assigned: "When the task was given to this person.",
  Seen: "When the person first opened the task.",
  Accepted: "When the person confirmed they have seen it and will do it.",
  Due: "The time by which the work should be done, counting only working hours.",
  "Missed deadline": "The deadline passed before the work was finished. This stays on record even if the deadline is moved later.",
};
function Step({ label, at, children }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.6 }}>
      <Tooltip title={STEP_HINT[label]}>
        <span tabIndex={STEP_HINT[label] ? 0 : undefined} style={{ minWidth: 110, color: "var(--color-surface-600)" }}>{label}</span>
      </Tooltip>
      <span>{at ? istStamp(at) : "—"}{children}</span>
    </div>
  );
}

// Deadline tab: per assignee clock, its timeline, breach/reason/verdict and the
// actions that apply. Visibility is a courtesy - the server is the judge.
export default function TatPanel({ task, canReassign, currentUserId }) {
  const taskId = task.Id;
  const queryClient = useQueryClient();
  const { data, isLoading } = useApiQuery({
    queryKey: ["task", taskId, "tat"],
    endpoint: TAT_ENDPOINTS.fetchTaskTat,
    params: { TaskId: taskId },
    showErrorMessage: false,
  });
  const clocks = data?.clocks ?? [];
  const holds = data?.holds ?? [];
  const events = data?.events ?? [];

  const [form, setForm] = useState(null); // {kind:'hold', mine} | {kind:'verdict', tatId, verdict}
  const [reasonId, setReasonId] = useState(null);
  const [remarks, setRemarks] = useState("");
  const [reasonTatId, setReasonTatId] = useState(null);
  const { lookups: holdReasons } = useLookups("task_hold_reason", {
    enabled: form?.kind === "hold",
    showErrorMessage: false,
  });

  const action = useMutation({
    mutationFn: async ({ endpoint, body }) => {
      const res = await apiClient.post(endpoint, { TaskId: taskId, ...body });
      if (!res.data?.success) throw new Error(res.data?.message || "Operation failed");
      return res.data;
    },
    onSuccess: (res) => {
      enqueueSnackbar(res.message || "Saved", { variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["tasks"], refetchType: "all" });
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      setForm(null);
      setReasonId(null);
      setRemarks("");
    },
    onError: (err) =>
      enqueueSnackbar(err.response?.data?.message || err.message || "Operation failed", { variant: "error" }),
  });
  const run = (endpoint, body = {}) => action.mutate({ endpoint, body });

  if (isLoading) return <Skeleton variant="rect" height={120} />;

  const openClocks = clocks.filter((c) => !c.ClosedAt);
  const holdOf = (c) => holds.find((h) => h.TatId === c.Id && !h.EndedAt);
  const anyUnheld = openClocks.some((c) => !holdOf(c));
  const anyManual = openClocks.some((c) => holdOf(c)?.Kind === "manual");

  const submitForm = () => {
    if (form.kind === "hold") {
      run(TAT_ENDPOINTS.hold, { Mine: form.mine, ReasonId: reasonId?.value, Remarks: remarks.trim() || null });
    } else {
      run(TAT_ENDPOINTS.saveVerdict, { TatId: form.tatId, Verdict: form.verdict, Remarks: remarks.trim() || null });
    }
  };
  const formReady = form?.kind === "hold"
    ? Boolean(reasonId)
    : form?.verdict !== "excused" || remarks.trim().length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="task-tat">
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {canReassign && openClocks.length > 0 && (<>
          {anyUnheld && (
            <Tip k="holdAll"><Button variant="tonal" size="sm" onClick={() => setForm({ kind: "hold", mine: false })} data-testid="tat-hold-all">
              Hold all
            </Button></Tip>
          )}
          {anyManual && (
            <Tip k="releaseAll"><Button variant="tonal" size="sm" onClick={() => run(TAT_ENDPOINTS.release, { Mine: false })} data-testid="tat-release-all">
              Resume all
            </Button></Tip>
          )}
        </>)}
        <span style={{ marginLeft: "auto" }}><HelpGuide guide={HELP_GUIDES.taskTat} /></span>
      </div>

      {clocks.length === 0 ? (
        <EmptyState
          icon={<Timer size={28} />}
          title="No deadline on this task"
          description="A deadline starts when someone is assigned on a shared or project board."
          size="sm"
        />
      ) : (
        clocks.map((c) => {
          const own = Number(c.UserId) === Number(currentUserId);
          const open = !c.ClosedAt;
          const hold = holdOf(c);
          const clockHolds = holds.filter((h) => h.TatId === c.Id);
          return (
            <Card key={c.Id} data-testid={`tat-clock-${c.Id}`}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <strong>{c.FullName}</strong>
                {open ? (
                  c.BreachedAt ? <Tip k="Missed deadline" tab><Chip size="sm" label="Missed deadline" tone="error" /></Tip>
                    : <Tip k={hold ? "On hold" : "Running"} tab><Chip size="sm" label={hold ? "On hold" : "Running"} tone={hold ? "default" : "info"} /></Tip>
                ) : (
                  <Tip k="Done" tab><Chip size="sm" label={CLOSE_LABEL[c.CloseReason] ?? "Closed"} /></Tip>
                )}
              </div>
              <Step label="Assigned" at={c.AssignedAt} />
              <Step label="Seen" at={c.FirstSeenAt} />
              <Step label="Accepted" at={c.AcknowledgedAt} />
              {clockHolds.map((h) => (
                <Step key={h.HoldId} label="On hold" at={h.StartedAt}>
                  {` → ${h.EndedAt ? istStamp(h.EndedAt) : "now"} · ${h.Kind === "blocked" ? "Blocked by a dependency" : h.Reason ?? ""}`}
                  {h.Remarks ? ` (${h.Remarks})` : ""}
                </Step>
              ))}
              <Step label="Due" at={c.DueAt} />
              {!open && <Step label={CLOSE_LABEL[c.CloseReason] ?? "Closed"} at={c.ClosedAt} />}
              {c.BreachedAt && (
                <>
                  <Step label="Missed deadline" at={c.BreachedAt}>
                    {c.DueAt ? ` · over by ${overBy((c.ClosedAt ? new Date(c.ClosedAt) : new Date()) - new Date(c.DueAt))}` : ""}
                  </Step>
                  <Step label="Reason" at={c.ReasonAt}>
                    {c.BreachReason ? ` · ${c.BreachReason}${c.BreachRemarks ? ` (${c.BreachRemarks})` : ""}` : " · pending"}
                  </Step>
                  {c.Verdict && (
                    <Step label="Manager's decision" at={c.VerdictAt}>
                      {` · ${VERDICT_LABEL[c.Verdict] ?? c.Verdict} by ${c.VerdictByName ?? "the system"}${c.VerdictRemarks ? ` (${c.VerdictRemarks})` : ""}`}
                    </Step>
                  )}
                </>
              )}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {own && open && !c.AcknowledgedAt && (
                  <Tip k="ack"><Button size="sm" variant="tonal" onClick={() => run(TAT_ENDPOINTS.acknowledge)} data-testid="tat-ack">
                    Accept task
                  </Button></Tip>
                )}
                {own && open && !hold && (
                  <Tip k="hold"><Button size="sm" variant="tonal" onClick={() => setForm({ kind: "hold", mine: true })} data-testid="tat-hold">
                    Put on hold
                  </Button></Tip>
                )}
                {own && open && hold?.Kind === "manual" && (
                  <Tip k="release"><Button size="sm" variant="tonal" onClick={() => run(TAT_ENDPOINTS.release, { Mine: true })} data-testid="tat-release">
                    Resume
                  </Button></Tip>
                )}
                {own && open && openClocks.length > 1 && (
                  <Tip k="mine"><Button size="sm" variant="tonal" onClick={() => run(TAT_ENDPOINTS.myPartDone)} data-testid="tat-my-part-done">
                    My part is done
                  </Button></Tip>
                )}
                {own && c.BreachedAt && !c.BreachReasonId && !c.Verdict && (
                  <Tip k="reason"><Button size="sm" variant="tonal" onClick={() => setReasonTatId(c.Id)} data-testid="tat-give-reason">
                    Explain delay
                  </Button></Tip>
                )}
                {c.CanJudge && c.BreachedAt && !c.Verdict && (
                  <>
                    <Tip k="excused"><Button size="sm" variant="tonal" onClick={() => setForm({ kind: "verdict", tatId: c.Id, verdict: "excused" })} data-testid="tat-excused">
                      Accept delay
                    </Button></Tip>
                    <Tip k="notExcused"><Button size="sm" variant="tonal" onClick={() => setForm({ kind: "verdict", tatId: c.Id, verdict: "not_excused" })} data-testid="tat-not-excused">
                      Reject delay
                    </Button></Tip>
                  </>
                )}
              </div>
            </Card>
          );
        })
      )}

      {form && (
        <Card data-testid="tat-form">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {form.kind === "hold" ? (
              <Combobox
                label={form.mine ? "Why is your part on hold?" : "Why is this task on hold?"}
                options={holdReasons.map((l) => ({ value: l.Id, label: l.Value }))}
                value={reasonId}
                onChange={(v) => setReasonId(v ?? null)}
                required
                data-testid="tat-hold-reason"
              />
            ) : (
              <strong>{VERDICT_LABEL[form.verdict]}</strong>
            )}
            <TextArea
              label="Remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              required={form.verdict === "excused"}
              data-testid="tat-remarks"
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="ghost" size="sm" onClick={() => { setForm(null); setRemarks(""); setReasonId(null); }}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={submitForm} disabled={!formReady} loading={action.isPending} data-testid="tat-form-save">
                Save
              </Button>
            </div>
          </div>
        </Card>
      )}

      {events.length > 0 && (
        <div data-testid="tat-events">
          <div style={{ fontSize: 13, fontWeight: 600, margin: "8px 0 4px" }}>History</div>
          {events.map((e) => (
            <div key={e.Id} style={{ fontSize: 12, lineHeight: 1.7, color: "var(--color-surface-600)" }}>
              {istStamp(e.At)} · {eventText(e)}{e.ActorName ? ` by ${e.ActorName}` : ""}
            </div>
          ))}
        </div>
      )}

      <BreachReasonDialog
        open={Boolean(reasonTatId)}
        tatId={reasonTatId}
        taskId={taskId}
        onClose={() => setReasonTatId(null)}
      />
    </div>
  );
}
