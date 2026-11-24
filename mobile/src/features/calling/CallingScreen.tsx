import { useEffect, useRef, useState } from "react";
import { AppState, Linking, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StackScreenProps } from "@react-navigation/stack";
import { isAxiosError } from "axios";
import { CalendarClock, Clock, Info, TriangleAlert } from "lucide-react-native";

import { fetchMyCallList, undoCallResult } from "../../api/callingQueries";
import { apiErrorMessage } from "../../api/errors";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import { spacing } from "../../theme";
import type { ApiEnvelope, CallContact, MyCallList } from "../../types/api";
import {
  Band, BandSheet, Button, EmptyState, ErrorCard, GroupHeader, InfoNote, ListGroup, ListRow, Screen,
  SegmentedTabs, Sheet, SkeletonRows, Text, useToast, type SheetRef,
} from "../../ui";
import { useAccess } from "../auth/useAccess";
import { clock, parseDate, whenText } from "../sales/leadHelpers";
import { CALLING_QUERY, RESULT_LABELS, emptyCopy, isOverdue, localDateTime, titleOf } from "./callingHelpers";
import { ContactCard } from "./ContactCard";
import { ResultSheets, type CallReply, type ResultSheetsHandle } from "./ResultSheets";

type Props = StackScreenProps<RootStackParamList, "Calling">;
type Tab = "toCall" | "callbacks" | "done";

/** A list in a refused reply's body (409 sends the fresh list). */
const listIn = (e: unknown): MyCallList | null => {
  const data = isAxiosError(e) ? (e.response?.data as ApiEnvelope<MyCallList> | undefined)?.data : null;
  return data?.head ? data : null;
};

/**
 * The caller's phone screen (spec §14, mockups P2–P9). It shows the list the
 * server sent and nothing it remembered (spec §3a): no search, no opening a
 * contact by id, no local copy of finished contacts.
 */
export default function CallingScreen({ navigation, route }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const canMark = useAccess("calling").edit;
  const [tab, setTab] = useState<Tab>(route.params?.tab ?? "toCall");
  const [script, setScript] = useState<string | null>(null);
  const scriptRef = useRef<SheetRef>(null);
  const sheets = useRef<ResultSheetsHandle>(null);
  // ponytail: in memory only — if the OS kills the app mid-call the caller taps Save result; persist to AsyncStorage if that proves common.
  const dial = useRef<{ contactId: number; dialedAt: string } | null>(null);

  // Opening the screen runs the top-up on the server, so never serve it stale.
  const query = useQuery({ queryKey: CALLING_QUERY, queryFn: fetchMyCallList, staleTime: 0, refetchOnWindowFocus: true });
  const list = query.data?.data ?? null;

  const put = (data: MyCallList) =>
    queryClient.setQueryData<ApiEnvelope<MyCallList>>(CALLING_QUERY, (old) =>
      old ? { ...old, data } : { success: true, message: "", responseCode: 200, data, timestamp: "" });

  /** The server said no: its sentence, and the list it sent (else a refetch). */
  const refused = (e: unknown) => {
    toast.error(apiErrorMessage(e, "Could not save. Try again."));
    const fresh = listIn(e);
    if (fresh) put(fresh);
    else if (isAxiosError(e) && e.response) void query.refetch();
  };

  const undo = useMutation({
    mutationFn: (attemptId: number) => undoCallResult(attemptId),
    onSuccess: (res) => {
      put(res.data!);
      toast.success("Undone");
    },
    onError: refused,
  });

  const saved = (reply: CallReply, { label, leadId }: { label: string; leadId?: number }) => {
    put(reply);
    if (leadId) {
      toast.success("Lead created", { label: "Open", onPress: () => navigation.navigate("LeadDetail", { leadId }) });
      return;
    }
    const last = reply.done[0];
    const attemptId = reply.AttemptId ?? last?.AttemptId;
    const offer = last?.CanUndo && attemptId ? { label: "Undo", onPress: () => undo.mutate(attemptId) } : undefined;
    toast.success(reply.head.Given > 0 ? `All done. Next ${reply.head.Given} are here` : `Saved: ${label}`, offer);
  };

  // Back from the dialler: the result sheet opens by itself for the contact just called.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !dial.current) return;
      const { contactId, dialedAt } = dial.current;
      dial.current = null;
      const cur = queryClient.getQueryData<ApiEnvelope<MyCallList>>(CALLING_QUERY)?.data;
      const contact = [...(cur?.toCall ?? []), ...(cur?.callbacks ?? [])].find((c) => c.Id === contactId);
      if (contact) sheets.current?.open(contact, dialedAt);
    });
    return () => sub.remove();
  }, [queryClient]);

  const call = (c: CallContact) => {
    dial.current = { contactId: c.Id, dialedAt: localDateTime(new Date()) };
    Linking.openURL(`tel:${c.Mobile}`).catch(() => {
      dial.current = null;
      toast.error("Can't open the dialer on this device");
    });
  };

  const scriptOf = (c: CallContact) => list?.lists.find((l) => l.CallListId === c.CallListId)?.Script ?? null;
  const card = (c: CallContact, timeChip?: Parameters<typeof ContactCard>[0]["timeChip"]) => (
    <ContactCard
      key={c.Id}
      contact={c}
      timeChip={timeChip}
      scriptAvailable={!!scriptOf(c)}
      onCall={() => call(c)}
      onResult={() => sheets.current?.open(c, null)}
      onScript={() => {
        setScript(scriptOf(c));
        scriptRef.current?.present();
      }}
    />
  );

  const now = new Date();
  const head = list?.head;
  const callbacks = [...(list?.callbacks ?? [])].sort((a, b) => (a.CallbackAt ?? "").localeCompare(b.CallbackAt ?? ""));
  const overdue = callbacks.some((c) => isOverdue(c, now));

  let body;
  if (!list) {
    body = query.isError ? <ErrorCard onRetry={() => void query.refetch()} /> : <SkeletonRows rows={4} />;
  } else if (tab === "toCall") {
    const [first, ...rest] = list.toCall;
    const empty = emptyCopy(list.head);
    body = first ? (
      <>
        {list.head.OutsideHours ? <InfoNote icon={Clock}>Outside calling hours — new contacts arrive tomorrow</InfoNote> : null}
        {card(first)}
        {rest.length ? (
          <View>
            <GroupHeader title="Up next" count={rest.length} />
            <ListGroup testID="up-next">
              {rest.map((c, i) => (
                <ListRow
                  key={c.Id}
                  noSeparator={i === 0}
                  title={titleOf(c)}
                  meta={[c.Mobile, c.City].filter(Boolean).join(" · ")}
                  chips={c.PhoneMark ? [{ label: c.PhoneMark === "dnc" ? "Do not call" : "Caution", tone: c.PhoneMark === "dnc" ? "red" : "butter", icon: TriangleAlert }] : undefined}
                />
              ))}
            </ListGroup>
          </View>
        ) : null}
      </>
    ) : (
      <EmptyState
        module="calling"
        top
        title={empty.title}
        message={empty.body}
        actionLabel={list.callbacks.length ? "See callbacks" : undefined}
        onAction={() => setTab("callbacks")}
      />
    );
  } else if (tab === "callbacks") {
    body = callbacks.length ? (
      <>
        {callbacks.map((c) => {
          const late = isOverdue(c, now);
          const when = whenText(c.CallbackAt, now) ?? "";
          return card(c, { label: late ? `Overdue · ${when}` : when, tone: late ? "red" : "sky", icon: CalendarClock });
        })}
        <InfoNote icon={Info}>{`Callbacks stay with you. You hold ${list.head.Callbacks} of ${list.head.CallbackCap}.`}</InfoNote>
      </>
    ) : (
      <EmptyState module="calling" icon={CalendarClock} top title="No callbacks" message="A call back booked for a time stays here with you." />
    );
  } else {
    body = list.done.length ? (
      <ListGroup testID="done-today">
        {list.done.map((d, i) => {
          const name = d.Name ?? "Contact";
          const at = parseDate(d.CalledAt);
          return (
            <ListRow
              key={d.AttemptId}
              noSeparator={i === 0}
              title={name}
              chips={[{ label: d.LeadId ? `${RESULT_LABELS[d.Result]} · lead` : RESULT_LABELS[d.Result], tone: d.Result === "interested" ? "green" : d.Result === "dnc" ? "red" : "slate" }]}
              right={at ? { text: clock(at) } : undefined}
              trailing={d.CanUndo ? (
                <Button size="xs" variant="ghost" title="Undo" accessibilityLabel={`Undo ${name}`} loading={undo.isPending} onPress={() => undo.mutate(d.AttemptId)} />
              ) : undefined}
            />
          );
        })}
      </ListGroup>
    ) : (
      <EmptyState module="calling" top title="No calls yet today" message="What you call shows here." />
    );
  }

  return (
    <Screen band>
      <Band
        variant="record"
        titleVariant="h2"
        title="Calling"
        subtitle={head ? `${head.ToCall} left · ${head.CalledToday} called today` : undefined}
        onBack={navigation.goBack}
      />
      <BandSheet scroll refresh={{ refreshing: query.isRefetching, onRefresh: () => void query.refetch() }}>
        <View style={styles.col}>
          <SegmentedTabs<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "toCall", label: "To call", count: list?.toCall.length },
              { value: "callbacks", label: "Callbacks", count: list?.callbacks.length, countTone: overdue ? "danger" : undefined },
              { value: "done", label: "Done today", count: list?.done.length },
            ]}
          />
          {body}
        </View>
      </BandSheet>
      <ResultSheets ref={sheets} canMark={canMark} onSaved={saved} onRefused={refused} />
      <Sheet ref={scriptRef} title="Script" padded>
        <Text variant="body">{script ?? ""}</Text>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({ col: { gap: spacing[3] } });
