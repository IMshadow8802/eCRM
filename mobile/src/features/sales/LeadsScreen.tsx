import { useCallback, useMemo, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { CloudOff, Plus, Search, TrendingUp } from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import { fetchLeads } from "../../api/leadQueries";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import type { Lead } from "../../types/api";
import { colors, spacing, SCREEN_PADDING } from "../../theme";
import { ChipGroup, EmptyState, Fab, Input, Refresher, Screen, ScreenHeader, Segmented } from "../../ui";
import { useAccess } from "../auth/useAccess";
import { LeadCard } from "./LeadCard";
import { LEAD_QUEUES, leadQueueParams, type LeadQueue, type LeadStatusFilter } from "./leadHelpers";
import { useLeadRefData } from "./useLeadRefData";

type Props = StackScreenProps<RootStackParamList, "Leads">;

const SUBTITLE: Record<LeadQueue, string> = {
  mine: "yours",
  all: "you can see",
  overdue: "overdue",
  unassigned: "unassigned",
};

const EMPTY: Record<LeadQueue, { title: string; message: string }> = {
  mine: { title: "No leads yet", message: "Leads you own show up here. Tap + to add one." },
  all: { title: "No leads", message: "Nothing in the leads you can see." },
  overdue: { title: "Nothing overdue", message: "Every follow-up is on time." },
  unassigned: { title: "Nothing unassigned", message: "Every lead has an owner." },
};

/** The leads list — same shape as Complaints: queue, status chips, search. */
export default function LeadsScreen({ navigation }: Props) {
  const userId = useAuthStore((s) => s.UserId);
  const { add: canAdd } = useAccess("leads");

  const [queue, setQueue] = useState<LeadQueue>("mine");
  const [status, setStatus] = useState<LeadStatusFilter>("all");
  const [search, setSearch] = useState("");
  // Debounced: one request once typing pauses, not one per key.
  // keepPreviousData below keeps the old rows up while it loads.
  const term = useDebouncedValue(search.trim());

  // No user yet = no query: a null OwnerId would turn Mine into the whole reach.
  const params = useMemo(
    () => (userId == null ? null : leadQueueParams(queue, status, userId, term)),
    [queue, status, userId, term],
  );

  // Pages of 50, fetched as the list nears its end. "list" in the key keeps an
  // infinite cache entry apart from any plain ["leads", …] query; invalidating
  // ["leads"] still reaches it.
  const leadsQuery = useInfiniteQuery({
    queryKey: ["leads", "list", params],
    queryFn: ({ pageParam }) => fetchLeads({ ...params, PageNumber: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last, all) =>
      all.length < (last.data?.pagination.totalPages ?? 0) ? all.length + 1 : undefined,
    enabled: params != null,
    placeholderData: keepPreviousData,
  });

  const { statuses } = useLeadRefData();
  const statusOptions = useMemo(
    () => [
      { value: "all" as LeadStatusFilter, label: "All" },
      ...statuses.map((s) => ({ value: s.Id as LeadStatusFilter, label: s.Value })),
    ],
    [statuses],
  );

  // Offset paging: a lead that changes mid-scroll can land on two pages.
  // First occurrence wins, so FlatList keys stay unique.
  const leads = useMemo(() => {
    const seen = new Set<number>();
    return (leadsQuery.data?.pages.flatMap((page) => page.data?.leads ?? []) ?? []).filter(
      (lead) => !seen.has(lead.Id) && seen.add(lead.Id),
    );
  }, [leadsQuery.data]);
  const total = leadsQuery.data?.pages[0]?.data?.pagination.totalRecords ?? leads.length;

  // Placeholder rows belong to the previous search: paging them would fetch
  // page 2 of the new one before its page 1 has landed.
  const { hasNextPage, isFetchingNextPage, isPlaceholderData, fetchNextPage } = leadsQuery;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isPlaceholderData) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isPlaceholderData, fetchNextPage]);
  const narrowed = status !== "all" || term.length > 0;

  const openLead = useCallback(
    (lead: Lead) => navigation.navigate("LeadDetail", { leadId: lead.Id }),
    [navigation],
  );

  return (
    <Screen>
      <ScreenHeader
        title="Leads"
        subtitle={`${total} ${SUBTITLE[queue]}`}
        tint="success"
        onBack={navigation.goBack}
      />

      <View style={styles.controls}>
        <Segmented value={queue} options={LEAD_QUEUES} onChange={setQueue} />
        <ChipGroup label="Filter by status" value={status} options={statusOptions} onChange={setStatus} />
        <Input
          value={search}
          onChangeText={setSearch}
          placeholder="Name, company or mobile"
          leftIcon={Search}
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      <FlatList
        testID="leads-list"
        data={leads}
        keyExtractor={(lead) => String(lead.Id)}
        contentContainerStyle={[styles.list, !leads.length && styles.listEmpty]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <Refresher
            // A queue switch or search refetches with the old rows up: that is
            // not a pull, so no spinner. Paging is not a pull either.
            refreshing={leadsQuery.isRefetching && !isPlaceholderData && !isFetchingNextPage}
            onRefresh={leadsQuery.refetch}
          />
        }
        renderItem={({ item }) => (
          <View style={styles.cardWrap}>
            <LeadCard lead={item} onPress={openLead} />
          </View>
        )}
        ListEmptyComponent={
          leadsQuery.isLoading ? null : (
            <EmptyState
              icon={leadsQuery.isError ? CloudOff : TrendingUp}
              title={
                leadsQuery.isError ? "Couldn't load leads" : narrowed ? "Nothing matches" : EMPTY[queue].title
              }
              message={
                leadsQuery.isError
                  ? "Pull down to try again."
                  : narrowed
                    ? "Try another status, or clear the search."
                    : EMPTY[queue].message
              }
            />
          )
        }
      />

      {/* Courtesy only: saveLeads create needs the add grant, so hide what would 403. */}
      {canAdd ? (
        <Fab icon={Plus} accessibilityLabel="Add a lead" onPress={() => navigation.navigate("LeadForm", {})} />
      ) : null}
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
  cardWrap: { paddingHorizontal: SCREEN_PADDING, paddingBottom: spacing[5] },
});
