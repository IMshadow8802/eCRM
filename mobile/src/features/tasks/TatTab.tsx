import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CirclePause, CircleX, MessageSquare, Timer } from "lucide-react-native";

import { apiErrorMessage } from "../../api/errors";
import { fetchLookups, LOOKUP_KIND } from "../../api/configQueries";
import {
  acknowledgeTat, fetchTaskTat, holdMine, myPartDone, releaseMine, saveTatReason, saveVerdict,
} from "../../api/tatQueries";
import { metrics, spacing, tatEventBadge, type ChipTone } from "../../theme";
import type { TaskTatClock, TaskTatHold } from "../../types/api";
import {
  Button, Card, Chip, ComposeSheet, EmptyState, ErrorCard, FigureBox, GroupHeader, HeroCard, ListGroup, ListRow,
  SkeletonRows, SplitBar, StatusBadge, Text, Timeline, useToast, type ComposeSheetProps, type SheetRef,
  type TimelineEntry,
} from "../../ui";
import { dayIst, eventText, hm, istStamp, parseIst, VERDICT_LABEL, whenIst } from "./tatChip";
import { shortSpan } from "./taskHelpers";

const CLOSE_LABEL: Record<string, string> = {
  completed: "Done",
  my_part_done: "Their part done",
  unassigned: "Unassigned",
  deleted: "Task deleted",
  user_left: "Left the company",
  no_clock: "No deadline",
};

type Form = "hold" | "reason" | "excused" | "not_excused";

const paren = (s: string | null) => (s ? ` (${s})` : "");
const holdReason = (h: TaskTatHold) => (h.Kind === "blocked" ? "Blocked by a dependency" : (h.Reason ?? "On hold"));
const ms = (v: string | null | undefined) => parseIst(v)?.getTime() ?? null;

/** The state pill on a clock: red Missed · green On time · slate On hold / closed · butter Due in. */
function clockState(c: TaskTatClock, hold: TaskTatHold | undefined, now: number): { label: string; tone: ChipTone } {
  if (c.BreachedAt) return { label: "Missed deadline", tone: "red" };
  if (c.ClosedAt) {
    return c.CloseReason === "completed" || c.CloseReason === "my_part_done"
      ? { label: "On time", tone: "green" }
      : { label: CLOSE_LABEL[c.CloseReason ?? ""] ?? "Closed", tone: "slate" };
  }
  if (hold) return { label: "On hold", tone: "slate" };
  const due = ms(c.DueAt);
  return due != null ? { label: `Due in ${shortSpan(due - now)}`, tone: "butter" } : { label: "Running", tone: "sky" };
}

/**
 * E 09's bar, on the clock: (end − start) / (due − start), clamped, then the
 * overrun past DueAt. Over by (G28) and the time left are wall-clock too. The
 * target (TatMinutes, working time) is a label and does not drive the bar.
 */
export function deadlineFigures(c: TaskTatClock, now: number) {
  const start = ms(c.AssignedAt);
  const due = ms(c.DueAt);
  const end = ms(c.ClosedAt) ?? now;
  const span = due != null && start != null ? due - start : 0;
  const over = due != null && end > due ? end - due : 0;
  const left = due != null && end <= due ? due - end : 0;
  let used = 0;
  let overrun = 0;
  if (span > 0 && start != null) {
    if (over > 0) {
      used = span / (span + over);
      overrun = over / (span + over);
    } else used = Math.min(1, Math.max(0, (end - start) / span));
  }
  return { over, left, used, overrun };
}

/** "8 working hours" / "7.5 working hours" — TatMinutes only (E 09's Due line). */
const workingHours = (minutes: number) => {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} working hour${h === 1 ? "" : "s"}`;
};

function timeline(c: TaskTatClock, holds: TaskTatHold[], tatMinutes: number | null | undefined, now: number): TimelineEntry[] {
  return [
    ...(c.AssignedAt
      ? [{ key: "started", title: "Started", time: whenIst(c.AssignedAt), meta: `Assigned to ${c.FullName ?? "someone"}`, badge: tatEventBadge("started") }]
      : []),
    ...holds.filter((h) => h.TatId === c.Id).map((h) => ({
      key: `hold-${h.HoldId}`,
      title: "Held",
      time: whenIst(h.StartedAt),
      meta: `${holdReason(h)}${paren(h.Remarks)} · ${hm((ms(h.EndedAt) ?? now) - (ms(h.StartedAt) ?? now))} added back${h.EndedAt ? "" : " so far"}`,
      badge: tatEventBadge("held"),
    })),
    ...(c.DueAt
      ? [{ key: "due", title: "Due", time: whenIst(c.DueAt), meta: tatMinutes && tatMinutes > 0 ? `${workingHours(tatMinutes)} from start` : undefined, badge: tatEventBadge("due") }]
      : []),
    ...(c.BreachedAt
      ? [{
        key: "breach",
        title: "Breached",
        time: whenIst(c.BreachedAt),
        meta: `Stays on record, even if reopened${c.BreachReason || c.Verdict ? "" : " · waiting for reason"}`,
        badge: tatEventBadge("breached"),
        danger: true,
      }]
      : []),
    ...(c.BreachReason
      ? [{ key: "reason", title: `Reason: ${c.BreachReason}${paren(c.BreachRemarks)}`, time: whenIst(c.ReasonAt), badge: { tone: "slate" as const, icon: MessageSquare } }]
      : []),
    ...(c.Verdict
      ? [{
        key: "verdict",
        title: `${VERDICT_LABEL[c.Verdict] ?? c.Verdict} by ${c.VerdictByName ?? "the system"}${paren(c.VerdictRemarks)}`,
        time: whenIst(c.VerdictAt),
        badge: c.Verdict === "excused" ? { tone: "green" as const, icon: CircleCheck } : { tone: "red" as const, icon: CircleX },
      }]
      : []),
    ...(c.ClosedAt
      ? [{ key: "closed", title: CLOSE_LABEL[c.CloseReason ?? ""] ?? "Closed", time: whenIst(c.ClosedAt), badge: { tone: "green" as const, icon: CircleCheck } }]
      : []),
  ];
}

/**
 * The task's deadline (E 09): the caller's clock as the indigo hero (Target ·
 * Over by, the split bar, "Explain delay" when a reason is owed), the hold,
 * the timeline. Own-clock actions (accept, hold/resume, my part done) sit under
 * the hero; other assignees' clocks are rows below, with Accept/Reject delay
 * where the server says CanJudge. The server is the judge.
 */
export function TatTab({
  taskId,
  userId,
  tatMinutes = null,
  explainTatId = null,
}: {
  taskId: number;
  userId: number | null;
  /** The task's own target, when it has one (else the clock's span). */
  tatMinutes?: number | null;
  /** Open the reason sheet for this clock once the tab loads (a tick just finished a breached task). */
  explainTatId?: number | null;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const sheetRef = useRef<SheetRef>(null);
  const [form, setForm] = useState<Form>(explainTatId ? "reason" : "hold");
  // Which clock a reason or verdict is for.
  const [target, setTarget] = useState<number | null>(explainTatId);
  const [formError, setFormError] = useState<string | null>(null);

  const tatQuery = useQuery({ queryKey: ["task", taskId, "tat"], queryFn: () => fetchTaskTat(taskId) });
  const holdReasons = useQuery({
    queryKey: ["lookups", LOOKUP_KIND.taskHoldReason],
    queryFn: () => fetchLookups({ Kind: LOOKUP_KIND.taskHoldReason }),
    enabled: form === "hold",
  });
  const breachReasons = useQuery({
    queryKey: ["lookups", LOOKUP_KIND.taskBreachReason],
    queryFn: () => fetchLookups({ Kind: LOOKUP_KIND.taskBreachReason }),
    enabled: form === "reason",
  });

  const done = () => {
    sheetRef.current?.dismiss();
    void qc.invalidateQueries({ queryKey: ["task", taskId] });
    void qc.invalidateQueries({ queryKey: ["tasks"] });
  };
  const quick = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save that.")),
    onSuccess: done,
  });
  const sheet = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onError: (err) => setFormError(apiErrorMessage(err, "Could not save that.")),
    onSuccess: done,
  });

  // Present once per clock: a refetch must not pop the sheet again.
  const shownFor = useRef<number | null>(null);
  const loaded = tatQuery.data != null;
  useEffect(() => {
    if (!explainTatId || !loaded || shownFor.current === explainTatId) return;
    shownFor.current = explainTatId;
    sheetRef.current?.present();
  }, [explainTatId, loaded]);

  if (tatQuery.isLoading) return <SkeletonRows rows={3} />;
  if (tatQuery.isError) return <ErrorCard onRetry={() => void tatQuery.refetch()} />;

  const { clocks, holds, events } = tatQuery.data ?? { clocks: [], holds: [], events: [] };
  if (!clocks.length) {
    return (
      <EmptyState
        module="tasks"
        icon={Timer}
        title="No deadline on this task"
        message="A deadline starts when someone is assigned a task on a shared or project board."
      />
    );
  }
  // When the clock was read: render stays pure, and a refetch moves it on.
  const now = tatQuery.dataUpdatedAt;
  const isMine = (c: TaskTatClock) => Number(c.UserId) === Number(userId);
  const mine = clocks.filter(isMine);
  const others = clocks.filter((c) => !isMine(c));
  const clock = mine.find((c) => !c.ClosedAt) ?? mine[mine.length - 1];
  const holdOf = (c: TaskTatClock) => holds.find((h) => h.TatId === c.Id && !h.EndedAt);

  const open = clock != null && !clock.ClosedAt;
  const hold = clock && holdOf(clock);
  const shownHold = clock ? (hold ?? holds.filter((h) => h.TatId === clock.Id).at(-1)) : undefined;
  const openClocks = clocks.filter((c) => !c.ClosedAt).length;
  const owesReason = clock != null && !!clock.BreachedAt && !clock.BreachReasonId && !clock.Verdict;

  const present = (f: Form, tatId: number | null = null) => {
    setForm(f);
    setTarget(tatId);
    setFormError(null);
    sheetRef.current?.present();
  };

  const breachList = breachReasons.data ?? [];
  const reasonOptions = ((form === "hold" ? holdReasons.data : breachList) ?? []).map((r) => ({ value: r.Id, label: r.Value }));
  const isOther = (id: string | number | undefined) => breachList.some((r) => r.Id === Number(id) && r.Code === "other");
  const SHEET: Record<Form, Pick<ComposeSheetProps, "title" | "submitLabel" | "fields">> = {
    hold: {
      title: "Why is your part on hold?",
      submitLabel: "Put on hold",
      fields: [{ key: "remarks", placeholder: "Remarks (optional)", label: "Remarks", multiline: true }],
    },
    reason: {
      title: "Why was the deadline missed?",
      submitLabel: "Save reason",
      fields: [{
        key: "remarks", placeholder: "Remarks (needed for Other)", label: "Remarks", multiline: true,
        required: (c) => isOther(c.reasonId),
      }],
    },
    excused: {
      title: "Accept the delay",
      submitLabel: "Save decision",
      fields: [{ key: "remarks", placeholder: "Remarks (needed to accept)", label: "Remarks", multiline: true, required: true }],
    },
    not_excused: {
      title: "Reject the delay",
      submitLabel: "Save decision",
      fields: [{ key: "remarks", placeholder: "Remarks (optional)", label: "Remarks", multiline: true }],
    },
  };
  const verdict = form === "excused" || form === "not_excused";

  let hero = null;
  if (clock) {
    const f = deadlineFigures(clock, now);
    const state = clockState(clock, hold, now);
    const working = tatMinutes != null && tatMinutes > 0;
    hero = (
      <HeroCard icon={Timer} title="Your clock" right={<Chip label={state.label} tone={state.tone} />}>
        <FigureBox
          figures={[
            // A label only: working time, which the wall-clock bar does not measure.
            { label: "Target", value: working ? hm(tatMinutes * 60_000) : "—" },
            f.over > 0
              ? { label: "Over by", value: hm(f.over), warn: true }
              // Clock time, labelled so: it is not working time left.
              : { label: clock.ClosedAt ? "Spare" : "Clock time left", value: hm(f.left) },
          ]}
        />
        <SplitBar used={f.used} overrun={f.overrun} />
        <View style={styles.foot}>
          <View style={styles.flex}>
            <Text variant="small" color="onBrandMuted">{working ? "Working time on your shift" : "Clock time from start"}</Text>
            {clock.DueAt ? <Text variant="small" color="onBrandMuted">{`Due ${whenIst(clock.DueAt)}`}</Text> : null}
          </View>
          {owesReason ? (
            <Button title="Explain delay" icon={MessageSquare} variant="onBrand" size="xs" onPress={() => present("reason")} />
          ) : null}
        </View>
      </HeroCard>
    );
  }

  const canAck = open && !clock.AcknowledgedAt;
  const canHold = open && !hold;
  const canResume = open && hold?.Kind === "manual" && Number(hold.StartedBy) === Number(userId);
  const canPart = open && openClocks > 1;

  return (
    <View>
      {hero}
      {shownHold ? (
        <Card gap={0} style={styles.holdCard} testID="hold-card">
          <View style={styles.holdRow}>
            <StatusBadge tone="butter" icon={CirclePause} />
            <View style={styles.flex}>
              <Text variant="label">Reason given for the hold</Text>
              <Text variant="bodyStrong" numberOfLines={2}>{`${holdReason(shownHold)}${paren(shownHold.Remarks)}`}</Text>
            </View>
            <Text variant="label" tabular>{dayIst(shownHold.StartedAt)}</Text>
          </View>
        </Card>
      ) : null}

      {clock ? (
        <Card style={styles.timeline}>
          <Timeline entries={timeline(clock, holds, tatMinutes, now)} />
        </Card>
      ) : null}

      {/* E has no place for these: they sit under the hold card and timeline. */}
      {canAck || canHold || canResume || canPart ? (
        <View style={styles.actions}>
          {canAck ? (
            <Button title="Accept task" variant="secondary" size="sm" loading={quick.isPending} onPress={() => quick.mutate(() => acknowledgeTat(taskId))} />
          ) : null}
          {canHold ? <Button title="Put on hold" variant="secondary" size="sm" onPress={() => present("hold")} /> : null}
          {canResume ? (
            <Button title="Resume" variant="secondary" size="sm" loading={quick.isPending} onPress={() => quick.mutate(() => releaseMine(taskId))} />
          ) : null}
          {canPart ? (
            <Button title="My part is done" variant="secondary" size="sm" loading={quick.isPending} onPress={() => quick.mutate(() => myPartDone(taskId))} />
          ) : null}
        </View>
      ) : null}


      {others.length ? (
        <>
          <GroupHeader label="Others on this task" first={!clock} />
          <ListGroup>
            {others.map((c, i) => {
              const s = clockState(c, holdOf(c), now);
              const judge = c.CanJudge && !!c.BreachedAt && !c.Verdict;
              return (
                <ListRow
                  key={c.Id}
                  noSeparator={i === 0}
                  badge={{ tone: s.tone === "red" ? "red" : s.tone === "green" ? "green" : "slate", icon: Timer }}
                  title={c.FullName ?? "Someone"}
                  meta={[
                    c.BreachReason ? `Reason: ${c.BreachReason}` : null,
                    c.Verdict ? (VERDICT_LABEL[c.Verdict] ?? c.Verdict) : null,
                  ].filter(Boolean).join(" · ") || undefined}
                  chips={[{ label: s.label, tone: s.tone }]}
                  trailing={
                    judge ? (
                      <View style={styles.judge}>
                        <Button title="Accept delay" size="xs" variant="secondary" onPress={() => present("excused", c.Id)} />
                        <Button title="Reject delay" size="xs" variant="secondary" onPress={() => present("not_excused", c.Id)} />
                      </View>
                    ) : undefined
                  }
                />
              );
            })}
          </ListGroup>
        </>
      ) : null}

      {events.length ? (
        <>
          <GroupHeader label="Clock history" />
          <ListGroup>
            {events.map((e, i) => (
              <ListRow
                key={e.Id}
                noSeparator={i === 0}
                title={`${eventText(e)}${e.ActorName ? ` by ${e.ActorName}` : ""}`}
                meta={istStamp(e.At)}
              />
            ))}
          </ListGroup>
        </>
      ) : null}

      <ComposeSheet
        ref={sheetRef}
        {...SHEET[form]}
        choices={verdict ? [] : [{ key: "reasonId", label: "Reason", required: true, options: reasonOptions }]}
        busy={sheet.isPending}
        error={formError}
        onSubmit={(v, c) => {
          const Remarks = v.remarks || null;
          if (form === "hold") {
            sheet.mutate(() => holdMine({ TaskId: taskId, ReasonId: Number(c.reasonId), Remarks }));
            return;
          }
          // A reason with no named clock is for the one shown; a verdict always names its clock.
          const TatId = verdict ? target : (target ?? clock?.Id ?? null);
          if (TatId == null) return;
          sheet.mutate(() =>
            verdict
              ? saveVerdict({ TaskId: taskId, TatId, Verdict: form, Remarks })
              : saveTatReason({ TaskId: taskId, TatId, ReasonId: Number(c.reasonId), Remarks }),
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  // ponytail: E's 10 has no spacing step; pairGap is the 10 in the scale.
  foot: { flexDirection: "row", alignItems: "center", gap: spacing[2], marginTop: metrics.pairGap },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2], marginTop: metrics.pairGap },
  holdCard: { marginTop: metrics.pairGap, paddingVertical: metrics.pairGap, paddingHorizontal: metrics.rowPadH },
  holdRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  timeline: { marginTop: metrics.pairGap },
  judge: { gap: spacing[1] },
});
