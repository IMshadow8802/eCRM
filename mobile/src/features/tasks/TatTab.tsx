import { useRef, useState } from "react";
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
} from "../../api/tatQueries";
import { colors, spacing, SCREEN_PADDING } from "../../theme";
import {
  Button,
  Chip,
  ComposeSheet,
  EmptyState,
  ScreenLoader,
  Text,
  Timeline,
  type SheetRef,
  type TimelineEntry,
  useToast,
} from "../../ui";
import { istStamp, overBy, parseIst } from "./tatChip";

const CLOSE_LABEL: Record<string, string> = {
  completed: "Done",
  my_part_done: "Their part done",
  unassigned: "Unassigned",
  deleted: "Task deleted",
  user_left: "Left the company",
  no_clock: "No deadline",
};

type Form = "hold" | "reason";

/**
 * The caller's own clock on this task: timeline plus the actions R-P4-4 allows
 * (acknowledge, hold/release own, my part done, give a breach reason). No
 * verdicts and no hold-everyone on mobile. The server is the judge.
 */
export function TatTab({ taskId, userId }: { taskId: number; userId: number | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const sheetRef = useRef<SheetRef>(null);
  const [form, setForm] = useState<Form>("hold");
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

  if (tatQuery.isLoading || tatQuery.isError) {
    return <ScreenLoader failed={tatQuery.isError} onRetry={tatQuery.refetch} />;
  }

  const { clocks, holds, events } = tatQuery.data ?? { clocks: [], holds: [], events: [] };
  const mine = clocks.filter((c) => Number(c.UserId) === Number(userId));
  const clock = mine.find((c) => !c.ClosedAt) ?? mine[mine.length - 1];
  if (!clock) {
    return (
      <EmptyState
        icon={Timer}
        title="No deadline on you"
        message="A deadline starts when you are assigned a task on a shared or project board."
      />
    );
  }

  const open = !clock.ClosedAt;
  const hold = holds.find((h) => h.TatId === clock.Id && !h.EndedAt);
  const openClocks = clocks.filter((c) => !c.ClosedAt).length;

  const step = (k: string, title: string, at: string | null, tone?: keyof typeof colors): TimelineEntry[] =>
    at ? [{ key: k, title, meta: istStamp(at), tone }] : [];
  const entries: TimelineEntry[] = [
    ...step("assigned", "Assigned", clock.AssignedAt),
    ...step("seen", "Seen", clock.FirstSeenAt),
    ...step("ack", "Accepted", clock.AcknowledgedAt),
    ...holds
      .filter((h) => h.TatId === clock.Id)
      .map((h) => ({
        key: `hold-${h.HoldId}`,
        title: `On hold: ${h.Kind === "blocked" ? "Blocked by a dependency" : (h.Reason ?? "")}${h.Remarks ? ` (${h.Remarks})` : ""}`,
        meta: `${istStamp(h.StartedAt)} → ${h.EndedAt ? istStamp(h.EndedAt) : "now"}`,
        tone: "warning" as const,
      })),
    ...step("due", "Due", clock.DueAt),
    ...(clock.BreachedAt
      ? [
          {
            key: "breach",
            title: `Missed deadline${clock.DueAt ? ` by ${overBy((parseIst(clock.ClosedAt) ?? new Date()).getTime() - (parseIst(clock.DueAt)?.getTime() ?? 0))}` : ""}`,
            meta: `${istStamp(clock.BreachedAt)} · ${
              clock.BreachReason
                ? `${clock.BreachReason}${clock.BreachRemarks ? ` (${clock.BreachRemarks})` : ""}`
                : "waiting for reason"
            }`,
            tone: "danger" as const,
          },
        ]
      : []),
    ...step("closed", CLOSE_LABEL[clock.CloseReason ?? ""] ?? "Closed", clock.ClosedAt, "success"),
  ];

  const present = (f: Form) => {
    setForm(f);
    setFormError(null);
    sheetRef.current?.present();
  };
  const reasons = (form === "hold" ? holdReasons.data : breachReasons.data) ?? [];

  return (
    <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
      <View style={styles.head}>
        {open ? (
          <Chip label={hold ? "On hold" : "Running"} tone={hold ? "neutral" : "info"} />
        ) : (
          <Chip label={CLOSE_LABEL[clock.CloseReason ?? ""] ?? "Closed"} />
        )}
      </View>

      <View style={styles.actions}>
        {open && !clock.AcknowledgedAt ? (
          <Button title="Accept task" variant="secondary" loading={quick.isPending}
            onPress={() => quick.mutate(() => acknowledgeTat(taskId))} />
        ) : null}
        {open && !hold ? (
          <Button title="Put on hold" variant="secondary" onPress={() => present("hold")} />
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
          <Button title="Explain delay" variant="secondary" onPress={() => present("reason")} />
        ) : null}
      </View>

      <Timeline entries={entries} />

      {events.length ? (
        <View style={styles.events}>
          <Text variant="label">History</Text>
          {events.map((e) => (
            <Text key={e.Id} variant="caption" color="textSecondary">
              {istStamp(e.At)} · {e.Kind}
              {e.ActorName ? ` by ${e.ActorName}` : ""}
            </Text>
          ))}
        </View>
      ) : null}

      <ComposeSheet
        ref={sheetRef}
        title={form === "hold" ? "Why is your part on hold?" : "Why was the deadline missed?"}
        submitLabel={form === "hold" ? "Put on hold" : "Save reason"}
        fields={[{ key: "remarks", placeholder: "Remarks (optional)", label: "Remarks", multiline: true }]}
        choices={[
          {
            key: "reasonId",
            label: "Reason",
            required: true,
            options: reasons.map((r) => ({ value: r.Id, label: r.Value })),
          },
        ]}
        busy={sheet.isPending}
        error={formError}
        onSubmit={(v, c) => {
          const body = { TaskId: taskId, ReasonId: Number(c.reasonId), Remarks: v.remarks || null };
          sheet.mutate(() =>
            form === "hold" ? holdMine(body) : saveTatReason({ ...body, TatId: clock.Id }),
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
  events: { gap: spacing[1] },
});
