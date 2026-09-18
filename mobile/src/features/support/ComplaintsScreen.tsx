import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
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

/** The four queues — WHICH rows. A status chip then narrows within one. */
type Queue = "mine" | "team" | "overdue" | "escalated";

const QUEUES: { value: Queue; label: string }[] = [
  { value: "mine", label: "Mine" },
  { value: "team", label: "Team" },
  { value: "overdue", label: "Overdue" },
  { value: "escalated", label: "Escalated" },
];

const SUBTITLE: Record<Queue, string> = {
  mine: "assigned to you",
  team: "in your team",
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
 *   overdue    non-terminal and past DueAt (the SP computes it; never stored)
 *   escalated  non-terminal and (escalated to me OR overdue) — a manager's queue
 *
 * A status chip other than "Active" replaces StatusCode with StatusId: sending
 * both would AND them, and "Resolved" within "active" is the empty set.
 */
function queueParams(
  queue: Queue,
  status: StatusFilter,
  userId: number | null,
  term: string,
): FetchTicketsParams {
  return {
    PageSize: 200,
    SearchTerm: term || null,
    AssignedTo: queue === "mine" ? userId : null,
    StatusCode: status === "active" ? "active" : null,
    StatusId: status === "active" ? null : status,
    Overdue: queue === "overdue",
    Escalated: queue === "escalated",
  };
}

/**
 * The complaints queue — a list, not a board.
 *
 * The board went with the pipeline engine (086). A stage column answered
 * "what is where"; a flat status with a due date answers the question a phone
 * is actually asked — what is mine, what is late, what has been pushed up to
 * me — and those are the four segments. Sorting is the server's:
 * overdue first, then by due time.
 */
export default function ComplaintsScreen({ navigation }: Props) {
  const userId = useAuthStore((s) => s.UserId);

  const [queue, setQueue] = useState<Queue>("mine");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [search, setSearch] = useState("");

  // Deferred rather than debounced with a timer: React keeps the old list on
  // screen while the new query resolves, so typing never blanks it and there
  // is no timeout to clean up.
  const term = useDeferredValue(search.trim());

  const params = useMemo(
    () => queueParams(queue, status, userId, term),
    [queue, status, userId, term],
  );

  const ticketsQuery = useQuery({
    queryKey: ["tickets", params],
    queryFn: () => fetchTickets(params),
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

  const tickets = ticketsQuery.data?.data?.tickets ?? [];
  const total = ticketsQuery.data?.data?.pagination.totalRecords ?? tickets.length;
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
        data={tickets}
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
