import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Linking, StyleSheet, View } from "react-native";
import { keepPreviousData, useInfiniteQuery, useQueries } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ArrowLeft, Plus } from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import { fetchTickets } from "../../api/ticketQueries";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useParamState } from "../../hooks/useParamState";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import { complaintBadge, metrics, spacing } from "../../theme";
import type { Ticket } from "../../types/api";
import {
  Band,
  BandSheet,
  EmptyState,
  ErrorCard,
  FilterPills,
  HeaderButton,
  InfoNote,
  ListGroupCell,
  Refresher,
  Screen,
  SkeletonRows,
  useLayout,
  type FilterOption,
  type TabOption,
} from "../../ui";
import { useAccess } from "../auth/useAccess";
import { ComplaintDetailBody } from "./ComplaintDetailBody";
import { ComplaintRow, type RowAction } from "./ComplaintRow";
import { ComplaintSheets, type ComplaintSheetsHandle } from "./ComplaintSheets";
import {
  complaintCountQuery,
  complaintQueueParams,
  statusFor,
  type ComplaintQueue,
  type ComplaintStatusFilter,
} from "./ticketHelpers";
import { useTicketRefData } from "./useTicketRefData";

type Props = StackScreenProps<RootStackParamList, "Complaints">;

/** §7.1: Unassigned stays, a fifth preset; the row scrolls sideways when it does not fit. */
const QUEUES: { value: ComplaintQueue; label: string }[] = [
  { value: "mine", label: "Mine" },
  { value: "team", label: "Team" },
  { value: "unassigned", label: "Unassigned" },
  { value: "overdue", label: "Overdue" },
  { value: "escalated", label: "Escalated" },
];

/** 20a, per preset. Escalated is E's copy; the others are proposed. */
const EMPTY: Record<ComplaintQueue, { title: string; message: string; showMine?: boolean }> = {
  mine: { title: "Nothing assigned to you", message: "Complaints assigned to you show up here." },
  team: { title: "No complaints here", message: "Nothing your team can see matches." },
  unassigned: { title: "Nobody is waiting", message: "Complaints that nobody has picked up show up here." },
  overdue: { title: "Nothing past its due time", message: "Every open complaint is inside its due time." },
  escalated: {
    title: "No complaints here",
    message: "Nothing is escalated to you right now. New escalations appear here and in your Inbox.",
    showMine: true,
  },
};

/** Shown until the first swipe action is used (proposed: kept on the phone). */
export const SWIPE_HINT_KEY = "complaints.swipeHint.seen";

/**
 * The complaints queue (E 10, 20a–c, 22; T2 with the record beside it).
 *
 * Presets in the band say WHICH complaints (their counts are active-only, the
 * same requests Home makes, so a Home number equals the preset it opens); the
 * list opens on "Active" — that same set — and the pills narrow by status
 * within it. Sorting is the
 * server's: overdue first, then by due time.
 */
export default function ComplaintsScreen({ navigation, route }: Props) {
  const layout = useLayout();
  const userId = useAuthStore((s) => s.UserId);
  const can = useAccess("complaints");

  // Active by default: the set every count (preset, Home, Search) counted, so a number equals the list it opens.
  const [status, setStatus] = useState<ComplaintStatusFilter>("active");
  const [search, setSearch] = useState(route.params?.term ?? "");
  // "Mine" unless a navigate() (Home's numbers, Search's "See all") asks for
  // another queue — which also resets the pill and takes the carried term, so
  // the list is exactly what was counted.
  const [queue, setQueue] = useParamState<ComplaintQueue>(route.params, route.params?.queue, "mine", () => {
    setStatus("active");
    setSearch(route.params?.term ?? "");
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [hint, setHint] = useState(false);
  const sheets = useRef<ComplaintSheetsHandle>(null);

  useEffect(() => {
    void AsyncStorage.getItem(SWIPE_HINT_KEY).then((seen) => setHint(!seen));
  }, []);

  const term = useDebouncedValue(search.trim());
  const params = useMemo(() => complaintQueueParams(queue, status, userId, term), [queue, status, userId, term]);

  const ticketsQuery = useInfiniteQuery({
    queryKey: ["tickets", params],
    queryFn: ({ pageParam }) => fetchTickets({ ...params, PageNumber: pageParam }),
    initialPageParam: 1,
    placeholderData: keepPreviousData,
    getNextPageParam: (last, _all, page) => (page < (last.data?.pagination.totalPages ?? 1) ? page + 1 : undefined),
  });

  const { statuses } = useTicketRefData();

  // G13: one PageSize-1 request per number, cached by its params.
  const total = (r: { data?: Awaited<ReturnType<typeof fetchTickets>> }) => r.data?.data?.pagination.totalRecords;
  const presetCounts = useQueries({
    queries: QUEUES.map((q) => complaintCountQuery(complaintQueueParams(q.value, "active", userId, ""))),
    combine: (rs) => rs.map(total),
  });
  const pillCounts = useQueries({
    queries: [
      complaintCountQuery(complaintQueueParams(queue, "active", userId, term)),
      ...statuses.map((s) => complaintCountQuery(complaintQueueParams(queue, s.Id, userId, term))),
    ],
    combine: (rs) => rs.map(total),
  });

  const tabs: TabOption<ComplaintQueue>[] = QUEUES.map((q, i) => ({
    ...q,
    count: presetCounts[i],
    countTone: q.value === "overdue" ? ("danger" as const) : undefined,
  }));
  const pills: FilterOption<ComplaintStatusFilter>[] = [
    // E draws "All"; the controller ruled "Active" so the first pill equals its preset (ledgered deviation).
    { value: "active", label: "Active", count: pillCounts[0] },
    ...statuses.map((s, i) => ({
      value: s.Id,
      label: s.Value,
      tone: complaintBadge(s.Code).chip,
      // E: a status with none reads without a number ("Rejected").
      count: pillCounts[i + 1] || undefined,
    })),
  ];

  const tickets = useMemo(() => ticketsQuery.data?.pages.flatMap((p) => p.data?.tickets ?? []) ?? [], [ticketsQuery.data]);
  const { hasNextPage, isFetchingNextPage, fetchNextPage, isPlaceholderData } = ticketsQuery;
  // The old rows under a new search are placeholders: their end is not this
  // query's end, so it asks for nothing more until the new page 1 lands.
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isPlaceholderData) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isPlaceholderData, fetchNextPage]);
  const narrowed = status !== "active" || term.length > 0;

  const openTicket = useCallback(
    (ticket: Ticket) => {
      if (layout.isTwoPane) setSelected(ticket.Id);
      else navigation.navigate("ComplaintDetail", { ticketId: ticket.Id });
    },
    [layout.isTwoPane, navigation],
  );

  // A swipe only reveals the blocks; a block opens its sheet (or the dialler).
  const onAction = useCallback(
    (action: RowAction, ticket: Ticket) => {
      setHint(false);
      void AsyncStorage.setItem(SWIPE_HINT_KEY, "1");
      if (action === "call") void Linking.openURL(`tel:${ticket.CustomerMobile}`);
      else sheets.current?.open(action, ticket);
    },
    [],
  );
  const canHold = !!statusFor(statuses, "onhold");

  const band = (
    <Band
      title="Complaints"
      gutter={layout.isTwoPane ? metrics.pane.listBand : undefined}
      actions={
        can.add ? (
          <HeaderButton label="New" icon={Plus} onPress={() => navigation.navigate("ComplaintForm", {})} accessibilityLabel="New complaint" />
        ) : null
      }
      search={{ value: search, onChangeText: setSearch, placeholder: "Search number, customer, mobile" }}
      tabs={{ value: queue, options: tabs, onChange: setQueue as (v: string) => void, spread: true, size: "sm", testID: "complaint-presets" }}
    />
  );

  const nothingAtAll = !term && status === "active" && pillCounts.every((c) => c === 0);
  const pillBleed = { marginRight: layout.isTwoPane ? layout.gutter - metrics.gutter : 0 };
  const empty = EMPTY[queue];
  let body;
  if (ticketsQuery.isLoading) {
    body = <SkeletonRows pills rows={6} />;
  } else if (ticketsQuery.isError && !tickets.length) {
    body = (
      <View testID="error-top" style={styles.errorTop}>
        <ErrorCard onRetry={() => void ticketsQuery.refetch()} />
      </View>
    );
  } else {
    body = (
      <>
        {/* The pills bleed by the window gutter; in the 420 pane the edge is 16 in.
            E 20a: a preset with nothing in any status has nothing to filter — no pills. */}
        {nothingAtAll ? null : (
          <View style={pillBleed}>
            <FilterPills label="Filter by status" value={status} options={pills} onChange={setStatus} testID="status-pills" />
          </View>
        )}
        <FlatList
          testID="complaints-list"
          style={styles.list}
          data={tickets}
          keyExtractor={(t) => String(t.Id)}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          contentContainerStyle={[styles.listContent, !tickets.length && styles.grow]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <Refresher refreshing={ticketsQuery.isRefetching && !isPlaceholderData} onRefresh={ticketsQuery.refetch} />
          }
          renderItem={({ item, index }) => (
            // One white group (E `.lg`), built per cell so the list stays virtualised.
            <ListGroupCell first={index === 0} last={index === tickets.length - 1}>
              <ComplaintRow
                ticket={item}
                first={index === 0}
                selected={layout.isTwoPane && item.Id === selected}
                onPress={openTicket}
                onAction={onAction}
                canWrite={can.edit}
                canHold={canHold}
              />
            </ListGroupCell>
          )}
          ListFooterComponent={
            hint && tickets.length && can.edit ? (
              <View style={styles.hint}>
                <InfoNote icon={ArrowLeft}>
                  Swipe left: Call · On hold · Resolve. Swipe right: Escalate. Each opens its sheet; nothing changes on the swipe alone.
                </InfoNote>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              top
              module="complaints"
              accents={["done", "escalated"]}
              title={narrowed ? "Nothing matches" : empty.title}
              message={narrowed ? "Try another status, or clear the search." : empty.message}
              actionLabel={!narrowed && empty.showMine ? "Show all of mine" : undefined}
              onAction={() => setQueue("mine")}
            />
          }
        />
      </>
    );
  }

  const list = (
    <>
      {band}
      <BandSheet padded={false}>
        {/* E T2: the list pane pads 16 whatever the window gutter (32 at expanded). */}
        <View testID="list-body" style={[styles.body, { paddingHorizontal: layout.isTwoPane ? metrics.pane.listSheet : layout.gutter }]}>
          {body}
        </View>
      </BandSheet>
    </>
  );

  return (
    <Screen band>
      {layout.isTwoPane ? (
        <View style={styles.panes}>
          <View style={styles.listPane}>{list}</View>
          <View style={styles.detailPane}>
            {selected != null ? (
              <ComplaintDetailBody
                key={selected}
                ticketId={selected}
                onEdit={(ticketId) => navigation.navigate("ComplaintForm", { ticketId })}
                onDeleted={() => setSelected(null)}
                onOpenTicket={setSelected}
              />
            ) : (
              <>
                <Band variant="record" tone="raised" gutter={metrics.pane.detailBand} />
                <BandSheet center gutter={metrics.pane.detailSheet}>
                  <EmptyState module="complaints" title="Pick a complaint" message="Its details open here, beside the list." />
                </BandSheet>
              </>
            )}
          </View>
        </View>
      ) : (
        list
      )}
      <ComplaintSheets ref={sheets} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // E 20c: the error card 72 from the top of the sheet.
  errorTop: { paddingTop: metrics.errorTop },
  body: { flex: 1, paddingTop: metrics.sheetPadTop },
  list: { marginTop: spacing[3] },
  listContent: { paddingBottom: spacing[6] },
  grow: { flexGrow: 1 },
  hint: { marginTop: spacing[3] },
  panes: { flex: 1, flexDirection: "row" },
  listPane: { width: metrics.listPaneWidth },
  detailPane: { flex: 1 },
});
