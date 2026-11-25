import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type RefObject } from "react";
import { StyleSheet, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  Ban, CalendarClock, CircleX, PhoneMissed, PhoneOff, StickyNote, ThumbsDown, ThumbsUp, TriangleAlert,
} from "lucide-react-native";

import { convertCallContact, saveCallResult } from "../../api/callingQueries";
import { apiErrorMessage } from "../../api/errors";
import { setPhoneMark } from "../../api/phoneMarkQueries";
import { spacing } from "../../theme";
import type { CallContact, CallResult, MyCallList } from "../../types/api";
import {
  ActionSheet, Button, ComposeSheet, DateField, Sheet, Text, useToast, type SheetAction, type SheetRef,
} from "../../ui";
import { clock, parseDate } from "../sales/leadHelpers";
import { RESULT_LABELS, callbackChoices, titleOf } from "./callingHelpers";

export type CallReply = MyCallList & { AttemptId?: number; LeadId?: number };

export interface ResultSheetsHandle {
  /** `dialedAt` null = saved without dialling (desk phone). */
  open(contact: CallContact, dialedAt: string | null): void;
}

export interface ResultSheetsProps {
  /** The calling edit grant: marking a number "caution" is a list manager's call on the server. */
  canMark: boolean;
  /** Every write answers with the fresh list. `leadId` only after Interested. */
  onSaved: (reply: CallReply, outcome: { label: string; leadId?: number }) => void;
  /** 403 / 404 / 409: the contact is no longer the caller's (or never was). */
  onRefused: (error: unknown) => void;
}

const FALLBACK = "Could not save. Try again.";
/** The server has decided about this contact; a retry would not help. */
const isRefusal = (e: unknown) => isAxiosError(e) && [403, 404, 409].includes(e.response?.status ?? 0);

/**
 * What happened on the call (spec §14.6, mockup P5–P8): one tap for the plain
 * results, a second step for Call back / Interested / Do not call. Menus are
 * literals; every sheet is presented through its ref.
 */
export const ResultSheets = forwardRef<ResultSheetsHandle, ResultSheetsProps>(function ResultSheets(
  { canMark, onSaved, onRefused },
  ref,
) {
  const toast = useToast();
  const [target, setTarget] = useState<{ contact: CallContact; dialedAt: string | null } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickDay, setPickDay] = useState<string | null>(null);
  const [pickTime, setPickTime] = useState<string | null>(null);

  const resultRef = useRef<SheetRef>(null);
  const callbackRef = useRef<SheetRef>(null);
  const pickRef = useRef<SheetRef>(null);
  const interestedRef = useRef<SheetRef>(null);
  const noteRef = useRef<SheetRef>(null);
  const cautionRef = useRef<SheetRef>(null);
  const dncRef = useRef<SheetRef>(null);

  // One write at a time: a second tap while the first is in flight must not save twice.
  const busy = useRef(false);
  const save = useMutation({ mutationFn: (p: Parameters<typeof saveCallResult>[0]) => saveCallResult(p) });
  const convert = useMutation({ mutationFn: (p: Parameters<typeof convertCallContact>[0]) => convertCallContact(p) });
  const mark = useMutation({ mutationFn: (p: Parameters<typeof setPhoneMark>[0]) => setPhoneMark(p) });

  useImperativeHandle(ref, () => ({
    open(contact, dialedAt) {
      setTarget({ contact, dialedAt });
      setNote(null);
      setError(null);
      resultRef.current?.present();
    },
  }), []);

  const present = (r: RefObject<SheetRef | null>) => {
    setError(null);
    r.current?.present();
  };

  /**
   * A failure. Refused and the contact gone → the screen says why and swaps the list. Otherwise
   * (a network failure, a 400, or a 409 that left the contact with them — the callback cap) the
   * caller retries from where they were: the open sheet with the sentence, or the result sheet.
   */
  const failed = (e: unknown, sheet?: RefObject<SheetRef | null>) => {
    const fresh = isAxiosError(e) ? (e.response?.data as { data?: MyCallList | null } | undefined)?.data : null;
    const id = target?.contact.Id;
    const stillMine = !!fresh?.head && [...fresh.toCall, ...fresh.callbacks].some((c) => c.Id === id);
    if (isRefusal(e) && !stillMine) {
      sheet?.current?.dismiss();
      setTarget(null);
      onRefused(e);
    } else if (sheet) {
      setError(apiErrorMessage(e, FALLBACK));
    } else {
      toast.error(apiErrorMessage(e, FALLBACK));
      resultRef.current?.present();
    }
  };

  const saveResult = async (Result: CallResult, extra: { CallbackAt?: string | null; Notes?: string } = {}, sheet?: RefObject<SheetRef | null>) => {
    if (!target || busy.current) return;
    busy.current = true;
    setError(null);
    try {
      const res = await save.mutateAsync({
        ContactId: target.contact.Id, Result, Notes: extra.Notes ?? note, DialedAt: target.dialedAt, CallbackAt: extra.CallbackAt ?? null,
      });
      sheet?.current?.dismiss();
      setTarget(null);
      onSaved(res.data as CallReply, { label: RESULT_LABELS[Result] });
    } catch (e) {
      failed(e, sheet);
    } finally {
      busy.current = false;
    }
  };

  const createLead = async (values: Record<string, string>, due: string | null) => {
    if (!target || !due || busy.current) return;
    busy.current = true;
    setError(null);
    try {
      const res = await convert.mutateAsync({
        ContactId: target.contact.Id, Name: values.name!, Notes: values.leadNote || null, FirstFollowupAt: due, DialedAt: target.dialedAt,
      });
      interestedRef.current?.dismiss();
      setTarget(null);
      const reply = res.data as CallReply;
      onSaved(reply, { label: RESULT_LABELS.interested, leadId: reply.LeadId });
    } catch (e) {
      failed(e, interestedRef);
    } finally {
      busy.current = false;
    }
  };

  const markCaution = async (Note: string) => {
    if (!target) return;
    setError(null);
    try {
      await mark.mutateAsync({ Mobile: target.contact.Mobile, Mark: "caution", Note });
      toast.success("Marked");
      cautionRef.current?.dismiss();
      resultRef.current?.present();
    } catch (e) {
      setError(apiErrorMessage(e, FALLBACK));
    }
  };

  const contact = target?.contact;
  const title = contact ? titleOf(contact) : "";
  // A new object per contact, so the Interested sheet reseeds its name.
  const leadSeed = useMemo(() => ({ name: contact ? titleOf(contact) : "", leadNote: note ?? "" }), [contact, note]);
  const noteSeed = useMemo(() => ({ pending: note ?? "" }), [note]);

  const actions: SheetAction[] = target
    ? [
      { key: "no_answer", label: "No answer", badge: { tone: "slate", icon: PhoneMissed }, onPress: () => void saveResult("no_answer") },
      { key: "busy", label: "Busy", badge: { tone: "butter", icon: PhoneOff }, onPress: () => void saveResult("busy") },
      { key: "not_interested", label: "Not interested", sublabel: "Closes it", badge: { tone: "peach", icon: ThumbsDown }, onPress: () => void saveResult("not_interested") },
      { key: "wrong_number", label: "Wrong number", sublabel: "Closes it", badge: { tone: "slate", icon: CircleX }, onPress: () => void saveResult("wrong_number") },
      { key: "callback", label: "Call back", sublabel: "Now or at a time", badge: { tone: "sky", icon: CalendarClock }, onPress: () => present(callbackRef) },
      { key: "interested", label: "Interested", sublabel: "Makes it your lead", badge: { tone: "green", icon: ThumbsUp }, onPress: () => present(interestedRef) },
      { key: "note", label: note ? "Edit note" : "Add a note", sublabel: note ?? "Optional, saved with the result", badge: { tone: "indigo", icon: StickyNote }, onPress: () => present(noteRef) },
      ...(canMark
        ? [{ key: "caution", label: "Call with caution", sublabel: "Warn whoever gets this number next", badge: { tone: "butter", icon: TriangleAlert }, onPress: () => present(cautionRef) } as SheetAction]
        : []),
      { key: "dnc", label: "Do not call", sublabel: "Never handed out again", tone: "danger", badge: { tone: "red", icon: Ban }, onPress: () => present(dncRef) },
    ]
    : [];

  const callbackActions: SheetAction[] = target
    ? callbackChoices(new Date()).map((c) => ({
      key: c.key,
      label: c.label,
      sublabel: c.key === "none" ? "Goes back to the pool; anyone may get it" : c.key === "pick" ? "Choose the day and time" : `${clock(parseDate(c.at)!)} · stays with you`,
      badge: { tone: c.key === "none" ? "slate" : "sky", icon: CalendarClock },
      onPress: () => {
        if (c.key === "pick") {
          setPickDay(null);
          setPickTime(null);
          present(pickRef);
        } else void saveResult("callback", { CallbackAt: c.at });
      },
    }))
    : [];

  return (
    <>
      <ActionSheet ref={resultRef} title={title} subtitle={contact?.Mobile} actions={actions} />
      <ActionSheet ref={callbackRef} title="Call back when?" subtitle={title} actions={callbackActions} />
      <ComposeSheet
        ref={interestedRef}
        title="Interested"
        subtitle={contact ? `${contact.Mobile} · goes to your leads` : undefined}
        badge={{ tone: "green", icon: ThumbsUp }}
        submitLabel="Create lead"
        fields={[
          { key: "name", label: "Name", placeholder: "Their name", required: true },
          { key: "leadNote", label: "Note", placeholder: "What did they want?", multiline: true },
        ]}
        when={{ label: "Follow up", required: true, initialChip: "tomorrow" }}
        initialValues={leadSeed}
        busy={convert.isPending}
        error={error}
        onSubmit={(values, _c, due) => void createLead(values, due)}
      />
      <ComposeSheet
        ref={noteRef}
        title="Add a note"
        subtitle={title}
        submitLabel="Keep note"
        fields={[{ key: "pending", placeholder: "Note for this call", multiline: true, required: true }]}
        initialValues={noteSeed}
        onSubmit={(values) => {
          setNote(values.pending!);
          noteRef.current?.dismiss();
          resultRef.current?.present();
        }}
      />
      {canMark ? (
        <ComposeSheet
          ref={cautionRef}
          title="Call with caution"
          subtitle={contact?.Mobile}
          badge={{ tone: "butter", icon: TriangleAlert }}
          submitLabel="Mark"
          fields={[{ key: "caution", placeholder: "What should the next caller know?", multiline: true, required: true }]}
          busy={mark.isPending}
          error={error}
          onSubmit={(values) => void markCaution(values.caution!)}
        />
      ) : null}
      <ComposeSheet
        ref={dncRef}
        title="Do not call this number?"
        subtitle="Nobody in the company will be given it again"
        badge={{ tone: "red", icon: Ban }}
        submitLabel="Do not call"
        fields={[{ key: "dnc", placeholder: "Why? An admin reads this", multiline: true, required: true }]}
        busy={save.isPending}
        error={error}
        onSubmit={(values) => void saveResult("dnc", { Notes: values.dnc }, dncRef)}
      />
      {/* Last: the pickers' "last mounted" sheet is this one. */}
      <Sheet ref={pickRef} title="Call back at" subtitle={title} padded>
        <View style={styles.pick}>
          <DateField label="Day" value={pickDay} minimumDate={new Date()} onChange={setPickDay} placeholder="Choose a day" />
          <DateField label="Time" mode="time" value={pickTime} day={pickDay} onChange={setPickTime} placeholder="Choose a time" />
          {error ? <Text variant="label" color="dangerText">{error}</Text> : null}
          <Button
            title="Book callback"
            fullWidth
            loading={save.isPending}
            disabled={!pickDay || !pickTime}
            onPress={() => void saveResult("callback", { CallbackAt: `${pickDay}T${pickTime}` }, pickRef)}
          />
        </View>
      </Sheet>
    </>
  );
});

const styles = StyleSheet.create({ pick: { gap: spacing[3] } });
