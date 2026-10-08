import { useState } from "react";
import { Timer } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";

import { Button, Card, Chip, Combobox, EmptyState, Skeleton, TextArea } from "../../../../components/ui";
import { useApiQuery } from "../../../../hooks/useApiQuery";
import { useLookups } from "../../../../hooks/useLookups";
import { apiClient } from "../../../../utils/axiosConfig";
import { TAT_ENDPOINTS } from "../../../../api/tatQueries";
import { istStamp, overBy, eventText, VERDICT_LABEL } from "../../../../utils/tatChip";
import BreachReasonDialog from "./BreachReasonDialog";

const CLOSE_LABEL = {
  completed: "Done",
  my_part_done: "Their part done",
  unassigned: "Unassigned",
  deleted: "Task deleted",
  user_left: "Left the company",
  no_clock: "Clock switched off",
};
function Step({ label, at, children }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.6 }}>
      <span style={{ minWidth: 110, color: "var(--color-surface-600)" }}>{label}</span>
      <span>{at ? istStamp(at) : "—"}{children}</span>
    </div>
  );
}

// TAT tab: per assignee clock, its timeline, breach/reason/verdict and the
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
      {canReassign && openClocks.length > 0 && (
        <div style={{ display: "flex", gap: 8 }}>
          {anyUnheld && (
            <Button variant="tonal" size="sm" onClick={() => setForm({ kind: "hold", mine: false })} data-testid="tat-hold-all">
              Hold all
            </Button>
          )}
          {anyManual && (
            <Button variant="tonal" size="sm" onClick={() => run(TAT_ENDPOINTS.release, { Mine: false })} data-testid="tat-release-all">
              Release all
            </Button>
          )}
        </div>
      )}

      {clocks.length === 0 ? (
        <EmptyState
          icon={<Timer size={28} />}
          title="No time target running"
          description="A clock starts when someone is assigned on a shared or project board."
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
                  <Chip size="sm" label={hold ? "On hold" : "Running"} tone={hold ? "default" : "info"} />
                ) : (
                  <Chip size="sm" label={CLOSE_LABEL[c.CloseReason] ?? "Closed"} />
                )}
              </div>
              <Step label="Assigned" at={c.AssignedAt} />
              <Step label="Seen" at={c.FirstSeenAt} />
              <Step label="Acknowledged" at={c.AcknowledgedAt} />
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
                  <Step label="Ran over" at={c.BreachedAt}>
                    {c.DueAt ? ` · over by ${overBy((c.ClosedAt ? new Date(c.ClosedAt) : new Date()) - new Date(c.DueAt))}` : ""}
                  </Step>
                  <Step label="Reason" at={c.ReasonAt}>
                    {c.BreachReason ? ` · ${c.BreachReason}${c.BreachRemarks ? ` (${c.BreachRemarks})` : ""}` : " · pending"}
                  </Step>
                  {c.Verdict && (
                    <Step label="Verdict" at={c.VerdictAt}>
                      {` · ${VERDICT_LABEL[c.Verdict] ?? c.Verdict} by ${c.VerdictByName ?? "the system"}${c.VerdictRemarks ? ` (${c.VerdictRemarks})` : ""}`}
                    </Step>
                  )}
                </>
              )}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {own && open && !c.AcknowledgedAt && (
                  <Button size="sm" variant="tonal" onClick={() => run(TAT_ENDPOINTS.acknowledge)} data-testid="tat-ack">
                    Acknowledge
                  </Button>
                )}
                {own && open && !hold && (
                  <Button size="sm" variant="tonal" onClick={() => setForm({ kind: "hold", mine: true })} data-testid="tat-hold">
                    Put on hold
                  </Button>
                )}
                {own && open && hold?.Kind === "manual" && (
                  <Button size="sm" variant="tonal" onClick={() => run(TAT_ENDPOINTS.release, { Mine: true })} data-testid="tat-release">
                    Release
                  </Button>
                )}
                {own && open && openClocks.length > 1 && (
                  <Button size="sm" variant="tonal" onClick={() => run(TAT_ENDPOINTS.myPartDone)} data-testid="tat-my-part-done">
                    My part is done
                  </Button>
                )}
                {own && c.BreachedAt && !c.BreachReasonId && !c.Verdict && (
                  <Button size="sm" variant="tonal" onClick={() => setReasonTatId(c.Id)} data-testid="tat-give-reason">
                    Give reason
                  </Button>
                )}
                {c.CanJudge && c.BreachedAt && !c.Verdict && (
                  <>
                    <Button size="sm" variant="tonal" onClick={() => setForm({ kind: "verdict", tatId: c.Id, verdict: "excused" })} data-testid="tat-excused">
                      Excused
                    </Button>
                    <Button size="sm" variant="tonal" onClick={() => setForm({ kind: "verdict", tatId: c.Id, verdict: "not_excused" })} data-testid="tat-not-excused">
                      Not excused
                    </Button>
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
          <div style={{ fontSize: 13, fontWeight: 600, margin: "8px 0 4px" }}>Changes</div>
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
