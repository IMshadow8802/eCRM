import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CalendarX, CircleCheck } from "lucide-react-native";

import { completeFollowUp, scheduleFollowUp, skipFollowUp } from "../../api/followupQueries";
import { apiErrorMessage } from "../../api/errors";
import type { CallDirection, FollowUp, FollowUpType } from "../../types/api";
import { ComposeSheet, type SheetRef } from "../../ui";
import {
  dueFromChoice,
  followUpTypeLabel,
  onDayAtTimeOf,
  parseDate,
  shortDay,
  WHEN_CHOICES,
  type WhenChoice,
} from "./leadHelpers";
import { useLeadRefData } from "./useLeadRefData";

export interface FollowUpSheetsHandle {
  /** Log it done (remarks required; a call also asks direction and minutes). */
  done: (f: FollowUp) => void;
  /** Move it to another day: skipped with the reason, re-booked as the same type. */
  reschedule: (f: FollowUp) => void;
  /** It is not happening (remarks required). */
  skip: (f: FollowUp) => void;
}

type Key = "done" | "reschedule" | "skip";

const DIRECTIONS = [
  { value: "out", label: "Outgoing" },
  { value: "in", label: "Incoming" },
];
const WHEN_OPTIONS = WHEN_CHOICES.map((w) => ({ value: w.value, label: w.label }));
/** Whole minutes: completeFollowUp's positiveInt drops a fraction. */
const wholeMinutes = (text: string | undefined): number | null => {
  const minutes = Math.round(Number(text));
  return minutes > 0 ? minutes : null;
};

/**
 * The three follow-up sheets the lead and the queue share (E 15, 17): done,
 * reschedule, skip. A refusal shows in the sheet, which keeps what was typed;
 * success refetches the lead, the lists and the queue.
 *
 * ponytail: the API has no reschedule — it is a new booking (same type,
 * assignee and time of day) and only then a skip of the old one with the
 * reason, so a failure never loses the follow-up. If the skip fails after the
 * booking, the sheet says so and a retry only retries the skip (`rebooked`
 * remembers which follow-up already has its replacement), so it never books
 * twice; add a reschedule endpoint if that ever bites.
 */
export const FollowUpSheets = forwardRef<FollowUpSheetsHandle>(function FollowUpSheets(_props, ref) {
  const queryClient = useQueryClient();
  const { callOutcomes } = useLeadRefData();
  const [current, setCurrent] = useState<FollowUp | null>(null);
  const [failure, setFailure] = useState<{ on: Key; message: string } | null>(null);
  /** Id of the follow-up whose replacement is already booked (a half-done reschedule). */
  const rebooked = useRef<{ id: number; due: string } | null>(null);
  const sheets = { done: useRef<SheetRef>(null), reschedule: useRef<SheetRef>(null), skip: useRef<SheetRef>(null) };

  const open = (on: Key) => (f: FollowUp) => {
    setCurrent(f);
    setFailure(null);
    sheets[on].current?.present();
  };
  useImperativeHandle(ref, () => ({ done: open("done"), reschedule: open("reschedule"), skip: open("skip") }));

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["lead", current?.LeadId] });
    queryClient.invalidateQueries({ queryKey: ["leads"] });
    queryClient.invalidateQueries({ queryKey: ["followups"] });
    queryClient.invalidateQueries({ queryKey: ["calls", "lead", current?.LeadId] });
  };
  const handlers = (on: Key, fallback: string) => ({
    onError: (err: unknown) => {
      setFailure({ on, message: apiErrorMessage(err, fallback) });
      // A reschedule can fail half-way (booked, old one not skipped): show that state.
      if (on === "reschedule") refresh();
    },
    onSuccess: () => {
      sheets[on].current?.dismiss();
      refresh();
    },
  });

  const complete = useMutation({ mutationFn: completeFollowUp, ...handlers("done", "Could not log the follow-up.") });
  const skip = useMutation({ mutationFn: skipFollowUp, ...handlers("skip", "Could not skip the follow-up.") });
  const reschedule = useMutation({
    mutationFn: async ({ f, due, remarks }: { f: FollowUp; due: string; remarks: string }) => {
      let booked = rebooked.current?.id === f.Id ? rebooked.current : null;
      if (!booked) {
        await scheduleFollowUp({
          LeadId: f.LeadId,
          Type: (f.Type ?? "call") as FollowUpType,
          DueAt: onDayAtTimeOf(f.DueAt, due),
          AssignedTo: f.AssignedTo,
        });
        booked = rebooked.current = { id: f.Id, due };
      }
      // A retry names the day actually booked, even if the picker changed since.
      const day = shortDay(parseDate(booked.due) as Date);
      try {
        await skipFollowUp({ Id: f.Id, Remarks: `Rescheduled to ${day}: ${remarks}` });
      } catch {
        throw new Error("Booked the new follow-up, but the old one is still open — skip it from the lead.");
      }
    },
    ...handlers("reschedule", "Could not reschedule the follow-up."),
  });
  const failed = (on: Key) => (failure?.on === on ? failure.message : null);
  const isCall = current?.Type === "call";
  const who = current?.LeadName ?? undefined;

  return (
    <>
      <ComposeSheet
        ref={sheets.done}
        title={`Log the ${followUpTypeLabel(current?.Type).toLowerCase()}`}
        subtitle={who}
        badge={{ tone: "green", icon: CircleCheck }}
        submitLabel="Mark done"
        busy={complete.isPending}
        error={failed("done")}
        choices={[
          ...(callOutcomes.length
            ? [{ key: "outcome", label: "Outcome", options: callOutcomes.map((o) => ({ value: o.Id, label: o.Value })) }]
            : []),
          ...(isCall ? [{ key: "direction", label: "Direction", options: DIRECTIONS }] : []),
          { key: "next", label: "Next follow-up", options: WHEN_OPTIONS },
        ]}
        fields={[
          { key: "remarks", label: "Remarks", placeholder: "What was discussed — the next person reads this", multiline: true, required: true },
          ...(isCall ? [{ key: "minutes", label: "Minutes", placeholder: "Call minutes", numeric: true }] : []),
        ]}
        onSubmit={(values, picked) => {
          if (!current) return;
          complete.mutate({
            Id: current.Id,
            Remarks: values.remarks ?? "",
            OutcomeId: (picked.outcome as number | undefined) ?? null,
            Direction: isCall ? ((picked.direction as CallDirection | undefined) ?? "out") : null,
            Duration: isCall ? wholeMinutes(values.minutes) : null,
            // ponytail: the next step is always a call, as the web's default; no type picker.
            NextType: picked.next ? "call" : null,
            NextDueAt: picked.next ? dueFromChoice(picked.next as WhenChoice) : null,
          });
        }}
      />

      <ComposeSheet
        ref={sheets.reschedule}
        title="Reschedule"
        subtitle={who}
        badge={{ tone: "butter", icon: CalendarClock }}
        submitLabel="Reschedule"
        busy={reschedule.isPending}
        error={failed("reschedule")}
        choices={[{ key: "when", label: "New day", required: true, options: WHEN_OPTIONS }]}
        fields={[{ key: "remarks", label: "Why", placeholder: "Why it is moving", multiline: true, required: true }]}
        onSubmit={(values, picked) => {
          if (!current) return;
          reschedule.mutate({ f: current, due: dueFromChoice(picked.when as WhenChoice), remarks: (values.remarks ?? "").trim() });
        }}
      />

      <ComposeSheet
        ref={sheets.skip}
        title="Skip this follow-up"
        subtitle={who}
        badge={{ tone: "slate", icon: CalendarX }}
        submitLabel="Skip follow-up"
        busy={skip.isPending}
        error={failed("skip")}
        fields={[{ key: "remarks", label: "Why", placeholder: "Why it is not happening", multiline: true, required: true }]}
        onSubmit={(values) => {
          if (!current) return;
          skip.mutate({ Id: current.Id, Remarks: values.remarks ?? "" });
        }}
      />
    </>
  );
});

export default FollowUpSheets;
