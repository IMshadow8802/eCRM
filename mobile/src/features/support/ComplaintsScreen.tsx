import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { CloudOff, Headset, Plus, Search } from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import { fetchTickets, type FetchTicketsParams } from "../../api/ticketQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import type { Ticket } from "../../types/api";
import { colors, spacing, SCREEN_PADDING } from "../../theme";
import {
  ChipGroup,
  EmptyState,
  Fab,
  Input,
  Refresher,
  Screen,
  ScreenHeader,
  Segmented,
} from "../../ui";
import { ComplaintCard } from "./ComplaintCard";
import { useTicketRefData } from "./useTicketRefData";

type Props = StackScreenProps<RootStackParamList, "Complaints">;

/** The queues — WHICH rows. A status chip then narrows within one. */
type Queue = "mine" | "team" | "unassigned" | "overdue" | "escalated";

const QUEUES: { value: Queue; label: string }[] = [
  { value: "mine", label: "Mine" },
  { value: "team", label: "Team" },
  { value: "unassigned", label: "Unassigned" },
  { value: "overdue", label: "Overdue" },
  { value: "escalated", label: "Escalated" },
];

const SUBTITLE: Record<Queue, string> = {
  mine: "assigned to you",
  team: "in your team",
  unassigned: "unassigned",
  overdue: "overdue",
  escalated: "escalated",
};

const EMPTY: Record<Queue, { title: string; message: string }> = {
  mine: {
    title: "Nothing on your plate",
    message: "Complaints assigned to you that are still open show up here.",
  },
  team: {
    title: "No open complaints",
    message: "Everything you can see is resolved, closed or rejected.",
  },
  unassigned: {
    title: "Nobody is waiting",
    message: "Open complaints that nobody has picked up show up here.",
  },
  overdue: {
    title: "Nothing overdue",
    message: "Every open complaint is inside its due time.",
  },
  escalated: {
    title: "Nothing escalated",
    message: "Complaints escalated to you, or overdue under you, land here.",
  },
};

/** "active" = every open/onhold status; a number = one ticket_status id. */
type StatusFilter = "active" | number;

/**
 * Which server-side filters each queue is, in one place, so the header count
 * and the list cannot disagree about what "Mine" means.
 *
 *   mine       assigned to me, still active
 *   team       everything I can see, still active — scope is the SP's
 *   unassigned active and nobody has it (web's preset of the same name)
 *   overdue    non-terminal and past DueAt (the SP computes it; never stored)
 *   escalated  non-terminal and (escalated to me OR overdue) — a manager's queue
 *
 * A status chip other than "Active" replaces StatusCode with StatusId: sending
 * both would AND them, and "Resolved" within "active" is the empty set.
 */
const SEARCH_DEBOUNCE_MS = 300;

/** Rows per page. The controller caps PageSize at 200 (controllerKit.js). */
const PAGE_SIZE = 50;

function queueParams(
  queue: Queue,
  status: StatusFilter,
  userId: number | null,
  term: string,
): FetchTicketsParams {
  return {
    PageSize: PAGE_SIZE,
    SearchTerm: term || null,
    AssignedTo: queue === "mine" ? userId : null,
    StatusCode: status === "active" ? "active" : null,
    StatusId: status === "active" ? null : status,
    Unassigned: queue === "unassigned",
    Overdue: queue === "overdue",
    Escalated: queue === "escalated",
  };
}

/**
 * The complaints queue — a list, not a board.
 *
 * The board went with the pipeline engine (086). A stage column answered
 * "what is where"; a flat status with a due date answers the question a phone
 * is actually asked — what is mine, what is late, what nobody has picked up,
 * what has been pushed up to me — and those are the segments. Sorting is the server's: newest
 * first, except Overdue and Escalated, which go most-overdue first (092).
 */
export default function ComplaintsScreen({ navigation }: Props) {
  const userId = useAuthStore((s) => s.UserId);

  const [queue, setQueue] = useState<Queue>("mine");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [search, setSearch] = useState("");

  // Debounced: one request once typing pauses, not one per keystroke (each
  // would also restart paging). keepPreviousData below holds the old rows on
  // screen while the new search loads.
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const params = useMemo(
    () => queueParams(queue, status, userId, term),
    [queue, status, userId, term],
  );

  const ticketsQuery = useInfiniteQuery({
    queryKey: ["tickets", params],
    queryFn: ({ pageParam }) => fetchTickets({ ...params, PageNumber: pageParam }),
    initialPageParam: 1,
    // A new search keeps the old rows up until its first page lands.
    placeholderData: keepPreviousData,
    getNextPageParam: (last, _all, page) =>
      page < (last.data?.pagination.totalPages ?? 1) ? page + 1 : undefined,
  });

  // Only the status list is needed here — every name on a card is on the row.
  const { statuses } = useTicketRefData();

  const statusOptions = useMemo(
    () => [
      { value: "active" as StatusFilter, label: "Active" },
      ...statuses.map((s) => ({ value: s.Id as StatusFilter, label: s.Value })),
    ],
    [statuses],
  );

  const tickets = useMemo(
    () => ticketsQuery.data?.pages.flatMap((p) => p.data?.tickets ?? []) ?? [],
    [ticketsQuery.data],
  );
  const total = ticketsQuery.data?.pages[0]?.data?.pagination.totalRecords ?? tickets.length;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = ticketsQuery;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const narrowed = status !== "active" || term.length > 0;

  const openTicket = useCallback(
    (ticket: Ticket) =>
      navigation.navigate("ComplaintDetail", { ticketId: ticket.Id }),
    [navigation],
  );

  return (
    <Screen>
      <ScreenHeader
        title="Complaints"
        subtitle={`${total} ${SUBTITLE[queue]}`}
        tint="danger"
        onBack={navigation.goBack}
      />

      <View style={styles.controls}>
        <Segmented value={queue} options={QUEUES} onChange={setQueue} />
        <ChipGroup
          label="Filter by status"
          value={status}
          options={statusOptions}
          onChange={setStatus}
        />
        <Input
          value={search}
          onChangeText={setSearch}
          placeholder="Ticket no., subject, customer or mobile"
          leftIcon={Search}
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      <FlatList
        testID="complaints-list"
        data={tickets}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        keyExtractor={(ticket) => String(ticket.Id)}
        contentContainerStyle={[styles.list, !tickets.length && styles.listEmpty]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <Refresher
            refreshing={ticketsQuery.isRefetching && !ticketsQuery.isLoading}
            onRefresh={ticketsQuery.refetch}
          />
        }
        renderItem={({ item }) => (
          <View style={styles.cardWrap}>
            <ComplaintCard ticket={item} onPress={openTicket} />
          </View>
        )}
        ListEmptyComponent={
          ticketsQuery.isLoading ? null : (
            <EmptyState
              icon={ticketsQuery.isError ? CloudOff : Headset}
              title={
                ticketsQuery.isError
                  ? "Couldn't load complaints"
                  : narrowed
                    ? "Nothing matches"
                    : EMPTY[queue].title
              }
              message={
                ticketsQuery.isError
                  ? "Pull down to try again."
                  : narrowed
                    ? "Try another status, or clear the search."
                    : EMPTY[queue].message
              }
            />
          )
        }
      />

      <Fab
        icon={Plus}
        accessibilityLabel="Log a complaint"
        onPress={() => navigation.navigate("ComplaintForm", {})}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  controls: {
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
    gap: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  // Clears the FAB so the last card stays reachable.
  list: { paddingTop: spacing[4], paddingBottom: spacing[20] },
  listEmpty: { flexGrow: 1 },
  // 20 between cards: the gap has to out-reach the card shadow, or stacked
  // shadows meet and the list reads as one grey slab (My Work does the same).
  cardWrap: { paddingHorizontal: SCREEN_PADDING, paddingBottom: spacing[5] },
});
