import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Timer } from "lucide-react-native";

import { apiErrorMessage } from "../../api/errors";
import { fetchLookups, LOOKUP_KIND } from "../../api/configQueries";
import {
  acknowledgeTat,
  fetchTaskTat,
  holdMine,
  myPartDone,
  releaseMine,
  saveTatReason,
  saveVerdict,
} from "../../api/tatQueries";
import type { TaskTatClock, TaskTatHold } from "../../types/api";
import { colors, spacing, SCREEN_PADDING } from "../../theme";
import {
  Button,
  Chip,
  ComposeSheet,
  EmptyState,
  ScreenLoader,
  Text,
  Timeline,
  type ComposeSheetProps,
  type SheetRef,
  type TimelineEntry,
  useToast,
} from "../../ui";
import { eventText, istStamp, overBy, parseIst, VERDICT_LABEL } from "./tatChip";

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

function clockChip(c: TaskTatClock, hold: TaskTatHold | undefined) {
  if (c.ClosedAt) return <Chip label={CLOSE_LABEL[c.CloseReason ?? ""] ?? "Closed"} />;
  if (c.BreachedAt) return <Chip label="Missed deadline" tone="danger" />;
  return <Chip label={hold ? "On hold" : "Running"} tone={hold ? "neutral" : "info"} />;
}

function clockEntries(c: TaskTatClock, holds: TaskTatHold[]): TimelineEntry[] {
  const step = (k: string, title: string, at: string | null, tone?: keyof typeof colors): TimelineEntry[] =>
    at ? [{ key: k, title, meta: istStamp(at), tone }] : [];
  return [
    ...step("assigned", "Assigned", c.AssignedAt),
    ...step("seen", "Seen", c.FirstSeenAt),
    ...step("ack", "Accepted", c.AcknowledgedAt),
    ...holds
      .filter((h) => h.TatId === c.Id)
      .map((h) => ({
        key: `hold-${h.HoldId}`,
        title: `On hold: ${h.Kind === "blocked" ? "Blocked by a dependency" : (h.Reason ?? "")}${paren(h.Remarks)}`,
        meta: `${istStamp(h.StartedAt)} → ${h.EndedAt ? istStamp(h.EndedAt) : "now"}`,
        tone: "warning" as const,
      })),
    ...step("due", "Due", c.DueAt),
    ...(c.BreachedAt
      ? [
          {
            key: "breach",
            title: `Missed deadline${c.DueAt ? ` by ${overBy((parseIst(c.ClosedAt) ?? new Date()).getTime() - (parseIst(c.DueAt)?.getTime() ?? 0))}` : ""}`,
            meta: `${istStamp(c.BreachedAt)}${c.BreachReason || c.Verdict ? "" : " · waiting for reason"}`,
            tone: "danger" as const,
          },
        ]
      : []),
    ...(c.BreachReason
      ? [{ key: "reason", title: `Reason: ${c.BreachReason}${paren(c.BreachRemarks)}`, meta: istStamp(c.ReasonAt) }]
      : []),
    ...(c.Verdict
      ? [
          {
            key: "verdict",
            title: `${VERDICT_LABEL[c.Verdict] ?? c.Verdict} by ${c.VerdictByName ?? "the system"}${paren(c.VerdictRemarks)}`,
            meta: istStamp(c.VerdictAt),
            tone: c.Verdict === "excused" ? ("success" as const) : ("danger" as const),
          },
        ]
      : []),
    ...step("closed", CLOSE_LABEL[c.CloseReason ?? ""] ?? "Closed", c.ClosedAt, "success"),
  ];
}

/**
 * The task's deadline clocks. The caller's own clock carries the R-P4-4
 * actions (acknowledge, hold/release own, my part done, breach reason); other
 * assignees' clocks are read-only, plus Accept/Reject delay where the server
 * says CanJudge. No hold-everyone on mobile. The server is the judge.
 */
export function TatTab({
  taskId,
  userId,
  explainTatId = null,
}: {
  taskId: number;
  userId: number | null;
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

  const key = ["task", taskId, "tat"];
  const tatQuery = useQuery({ queryKey: key, queryFn: () => fetchTaskTat(taskId) });
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
    qc.invalidateQueries({ queryKey: ["task", taskId] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  };
  const fail = (err: unknown) => toast.error(apiErrorMessage(err, "Could not save that."));
  const quick = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onError: fail,
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

  if (tatQuery.isLoading || tatQuery.isError) {
    return <ScreenLoader failed={tatQuery.isError} onRetry={tatQuery.refetch} />;
  }

  const { clocks, holds, events } = tatQuery.data ?? { clocks: [], holds: [], events: [] };
  if (!clocks.length) {
    return (
      <EmptyState
        icon={Timer}
        title="No deadline on this task"
        message="A deadline starts when someone is assigned a task on a shared or project board."
      />
    );
  }
  const isMine = (c: TaskTatClock) => Number(c.UserId) === Number(userId);
  const mine = clocks.filter(isMine);
  const others = clocks.filter((c) => !isMine(c));
  const clock = mine.find((c) => !c.ClosedAt) ?? mine[mine.length - 1];
  const holdOf = (c: TaskTatClock) => holds.find((h) => h.TatId === c.Id && !h.EndedAt);

  const open = clock != null && !clock.ClosedAt;
  const hold = clock && holdOf(clock);
  const openClocks = clocks.filter((c) => !c.ClosedAt).length;

  const present = (f: Form, tatId: number) => {
    setForm(f);
    setTarget(tatId);
    setFormError(null);
    sheetRef.current?.present();
  };

  const breachList = breachReasons.data ?? [];
  const reasonOptions = ((form === "hold" ? holdReasons.data : breachList) ?? []).map((r) => ({
    value: r.Id,
    label: r.Value,
  }));
  const isOther = (id: string | number | undefined) =>
    breachList.some((r) => r.Id === Number(id) && r.Code === "other");
  const SHEET: Record<Form, Pick<ComposeSheetProps, "title" | "submitLabel" | "fields">> = {
    hold: {
      title: "Why is your part on hold?",
      submitLabel: "Put on hold",
      fields: [{ key: "remarks", placeholder: "Remarks (optional)", label: "Remarks", multiline: true }],
    },
    reason: {
      title: "Why was the deadline missed?",
      submitLabel: "Save reason",
      fields: [
        {
          key: "remarks",
          placeholder: "Remarks (needed for Other)",
          label: "Remarks",
          multiline: true,
          required: (c) => isOther(c.reasonId),
        },
      ],
    },
    excused: {
      title: "Accept the delay",
      submitLabel: "Save decision",
      fields: [{ key: "remarks", placeholder: "Remarks", label: "Remarks", multiline: true, required: true }],
    },
    not_excused: {
      title: "Reject the delay",
      submitLabel: "Save decision",
      fields: [{ key: "remarks", placeholder: "Remarks (optional)", label: "Remarks", multiline: true }],
    },
  };
  const verdict = form === "excused" || form === "not_excused";

  return (
    <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
      {clock ? (
        <>
          <View style={styles.head}>{clockChip(clock, hold)}</View>

          <View style={styles.actions}>
            {open && !clock.AcknowledgedAt ? (
              <Button title="Accept task" variant="secondary" loading={quick.isPending}
                onPress={() => quick.mutate(() => acknowledgeTat(taskId))} />
            ) : null}
            {open && !hold ? (
              <Button title="Put on hold" variant="secondary" onPress={() => present("hold", clock.Id)} />
            ) : null}
            {open && hold?.Kind === "manual" && Number(hold.StartedBy) === Number(userId) ? (
              <Button title="Resume" variant="secondary" loading={quick.isPending}
                onPress={() => quick.mutate(() => releaseMine(taskId))} />
            ) : null}
            {open && openClocks > 1 ? (
              <Button title="My part is done" variant="secondary" loading={quick.isPending}
                onPress={() => quick.mutate(() => myPartDone(taskId))} />
            ) : null}
            {clock.BreachedAt && !clock.BreachReasonId && !clock.Verdict ? (
              <Button title="Explain delay" variant="secondary" onPress={() => present("reason", clock.Id)} />
            ) : null}
          </View>

          <Timeline entries={clockEntries(clock, holds)} />
        </>
      ) : null}

      {others.map((c) => (
        <View key={c.Id} style={styles.other}>
          <View style={styles.head}>
            <Text variant="label">{c.FullName ?? "Someone"}</Text>
            {clockChip(c, holdOf(c))}
          </View>
          {c.CanJudge && c.BreachedAt && !c.Verdict ? (
            <View style={styles.actions}>
              <Button title="Accept delay" variant="secondary" onPress={() => present("excused", c.Id)} />
              <Button title="Reject delay" variant="secondary" onPress={() => present("not_excused", c.Id)} />
            </View>
          ) : null}
          <Timeline entries={clockEntries(c, holds)} />
        </View>
      ))}

      {events.length ? (
        <View style={styles.events}>
          <Text variant="label">History</Text>
          {events.map((e) => (
            <Text key={e.Id} variant="caption" color="textSecondary">
              {`${istStamp(e.At)} · ${eventText(e)}${e.ActorName ? ` by ${e.ActorName}` : ""}`}
            </Text>
          ))}
        </View>
      ) : null}

      <ComposeSheet
        ref={sheetRef}
        {...SHEET[form]}
        choices={
          verdict
            ? []
            : [{ key: "reasonId", label: "Reason", required: true, options: reasonOptions }]
        }
        busy={sheet.isPending}
        error={formError}
        onSubmit={(v, c) => {
          const Remarks = v.remarks || null;
          // present() or explainTatId always sets the target before the sheet opens.
          const TatId = Number(target);
          sheet.mutate(() =>
            verdict
              ? saveVerdict({ TaskId: taskId, TatId, Verdict: form, Remarks })
              : form === "hold"
                ? holdMine({ TaskId: taskId, ReasonId: Number(c.reasonId), Remarks })
                : saveTatReason({ TaskId: taskId, TatId, ReasonId: Number(c.reasonId), Remarks }),
          );
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: SCREEN_PADDING, paddingBottom: spacing[20], gap: spacing[4] },
  head: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  other: { gap: spacing[3] },
  events: { gap: spacing[1] },
});
