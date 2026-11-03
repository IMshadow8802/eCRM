import { useCallback, useMemo, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { keepPreviousData, useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import { fetchLeads } from "../../api/leadQueries";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useParamState } from "../../hooks/useParamState";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import type { Lead } from "../../types/api";
import { metrics, spacing } from "../../theme";
import {
  Band,
  BandSheet,
  EmptyState,
  ErrorCard,
  FilterPills,
  GroupHeader,
  HeaderButton,
  ListGroupCell,
  Refresher,
  Screen,
  SkeletonRows,
  useLayout,
} from "../../ui";
import { useAccess } from "../auth/useAccess";
import { LeadDetailBody } from "./LeadDetailBody";
import {
  firstOpenStatus,
  LEAD_QUEUES,
  leadCountQuery,
  leadQueueParams,
  leadStatusBadge,
  OPEN_VALUE_PAGE,
  openValue,
  rupees,
  type LeadQueue,
  type LeadStatusFilter,
} from "./leadHelpers";
import { LeadRow } from "./LeadRow";
import { useLeadRefData } from "./useLeadRefData";

type Props = StackScreenProps<RootStackParamList, "Leads">;

const SUBTITLE: Record<LeadQueue, string> = {
  mine: "yours",
  all: "you can see",
  overdue: "overdue",
  new: "new",
  unassigned: "unassigned",
};

const EMPTY: Record<LeadQueue, { title: string; message: string }> = {
  mine: { title: "No leads yet", message: "Leads you own show up here. Tap New to add one." },
  all: { title: "No leads", message: "Nothing in the leads you can see." },
  overdue: { title: "Nothing overdue", message: "Every follow-up is on time." },
  new: { title: "No new leads", message: "Every lead has been contacted." },
  unassigned: { title: "Nothing unassigned", message: "Every lead has an owner." },
};

/** The T3 pane's band is the record's; it publishes no action bar (the rail is up). */
const inPane = () => ({ inBand: true });

/**
 * Leads (E 14): presets in the band with counts — Mine · All · Overdue · New,
 * then Unassigned (§7.1) — the status pills under them (§7.2), and rows by
 * next follow-up with the list's open value (G3). At the expanded size the
 * record opens beside the list (T3) and a row tap selects instead of pushing.
 */
export default function LeadsScreen({ navigation, route }: Props) {
  const userId = useAuthStore((s) => s.UserId);
  const { add: canAdd } = useAccess("leads");
  const { isTwoPane, gutter } = useLayout();
  // E T3: the 420 list pane's sheet pads 16, whatever the window gutter (32 at expanded).
  const pad = { paddingTop: metrics.sheetPadTop, paddingHorizontal: isTwoPane ? metrics.pane.listSheet : gutter };

  const [status, setStatus] = useState<LeadStatusFilter>("all");
  // Search's "See all" carries its term in; Home and Search carry a queue.
  const [search, setSearch] = useState(route.params?.term ?? "");
  // A navigate() with a queue drops the chip and search left on this mounted
  // tab, so the list is exactly what Home or Search counted.
  const [queue, setQueue] = useParamState<LeadQueue>(route.params, route.params?.queue, "mine", () => {
    setStatus("all");
    setSearch(route.params?.term ?? "");
  });
  const term = useDebouncedValue(search.trim());
  const [selected, setSelected] = useState<number | null>(null);

  const { statuses } = useLeadRefData();
  const newId = firstOpenStatus(statuses);

  // No user yet = no query: a null OwnerId would turn Mine into the whole reach.
  // No "new" status yet = no New query: a null StatusId would list every status.
  const build = useCallback(
    (q: LeadQueue, s: LeadStatusFilter) =>
      userId == null || (q === "new" && newId == null) ? null : leadQueueParams(q, s, userId, term, newId),
    [userId, term, newId],
  );
  const params = useMemo(() => build(queue, status), [build, queue, status]);

  // Pages of 50, fetched as the list nears its end. "list" in the key keeps an
  // infinite cache entry apart from the counts; invalidating ["leads"] reaches all.
  const leadsQuery = useInfiniteQuery({
    queryKey: ["leads", "list", params],
    queryFn: ({ pageParam }) => fetchLeads({ ...params, PageNumber: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (all.length < (last.data?.pagination.totalPages ?? 0) ? all.length + 1 : undefined),
    enabled: params != null,
    placeholderData: keepPreviousData,
  });

  const presetCounts = useQueries({ queries: LEAD_QUEUES.map((q) => leadCountQuery(build(q.value, "all"), q.value)) });
  const pillQueries: ReturnType<typeof leadCountQuery>[] =
    // While a search is set the pills go without counts: N requests per typed term
    // is a storm for little use. The presets' counts follow the (debounced) term.
    queue === "new" || term ? [] : statuses.map((s) => leadCountQuery(build(queue, s.Id), `status-${s.Id}`));
  const pillCounts = useQueries({ queries: pillQueries });
  const totalOf = (r: { data?: { data?: { pagination?: { totalRecords?: number } } | null } }) =>
    r.data?.data?.pagination?.totalRecords;

  // G3: one 200-row page of this list, summed.
  // G3 is Mine's open value (spec), whatever the preset, pill or search: one stable request.
  const mineParams = useMemo(() => (userId == null ? null : leadQueueParams("mine", "all", userId, "")), [userId]);
  const valueQuery = useQuery({
    queryKey: ["leads", "value", mineParams],
    queryFn: () => fetchLeads({ ...mineParams, PageSize: OPEN_VALUE_PAGE, PageNumber: 1 }),
    enabled: mineParams != null,
  });
  const value = valueQuery.data?.data
    ? openValue(valueQuery.data.data.leads, valueQuery.data.data.pagination.totalRecords)
    : null;

  // Offset paging: a lead that changes mid-scroll can land on two pages. First wins.
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
  // New hides the pills (and ignores the status), so a pill left from another preset is no narrowing.
  const narrowed = (queue !== "new" && status !== "all") || term.length > 0;

  // The picked lead stays in the pane even after it leaves the list (a transfer,
  // a status move): jumping to another would make the next tap act on the wrong
  // lead. The first row stands in only until something is picked.
  const shownId = isTwoPane ? (selected ?? leads[0]?.Id ?? null) : null;
  const openLead = useCallback(
    (lead: Lead) => (isTwoPane ? setSelected(lead.Id) : navigation.navigate("LeadDetail", { leadId: lead.Id })),
    [isTwoPane, navigation],
  );

  const pills =
    queue === "new" ? null : (
      <View style={styles.pills}>
        <FilterPills
          label="Filter by status"
          value={status}
          onChange={setStatus}
          options={[
            // "All" is this preset's own count: the same query as its band tab.
            { value: "all" as LeadStatusFilter, label: "All", count: totalOf(presetCounts[LEAD_QUEUES.findIndex((q) => q.value === queue)] ?? {}) },
            ...statuses.map((s, i) => ({
              value: s.Id as LeadStatusFilter,
              label: s.Value,
              count: totalOf(pillCounts[i] ?? {}),
              tone: leadStatusBadge(statuses, s.Code, s.Id).chip,
            })),
          ]}
        />
      </View>
    );
  const header = (
    <>
      {pills}
      {isTwoPane ? null : (
        <GroupHeader
          label="By next follow-up"
          first={!pills}
          right={value != null ? `Open value ${rupees(value)}` : undefined}
        />
      )}
    </>
  );

  const list = (
    <View style={[styles.fill, isTwoPane && styles.listPane]}>
      <Band
        variant="tabs"
        title="Leads"
        // E T3: the list pane's band pads 20.
        gutter={isTwoPane ? metrics.pane.listBand : undefined}
        count={`${total} ${SUBTITLE[queue]}`}
        actions={
          // Courtesy only: a create needs the add grant, so hide what would 403.
          canAdd ? <HeaderButton label="New" icon={Plus} onPress={() => navigation.navigate("LeadForm", {})} accessibilityLabel="New lead" /> : null
        }
        search={{ value: search, onChangeText: setSearch, placeholder: "Search name, company, mobile" }}
        tabs={{
          value: queue,
          onChange: (v) => setQueue(v as LeadQueue),
          spread: true,
          options: LEAD_QUEUES.map((q, i) => ({
            value: q.value,
            label: q.label,
            count: totalOf(presetCounts[i] ?? {}),
            countTone: q.value === "overdue" ? ("danger" as const) : undefined,
          })),
        }}
      />
      <BandSheet padded={false}>
        {leadsQuery.isError && !leads.length ? (
          <View style={pad}>
            {header}
            <ErrorCard onRetry={() => void leadsQuery.refetch()} />
          </View>
        ) : leadsQuery.isLoading || params == null ? (
          <View style={pad}>
            {header}
            <SkeletonRows />
          </View>
        ) : (
          <FlatList
            testID="leads-list"
            data={leads}
            keyExtractor={(lead) => String(lead.Id)}
            contentContainerStyle={[pad, styles.list, !leads.length && styles.listEmpty]}
            ListHeaderComponent={header}
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
            renderItem={({ item, index }) => (
              // One rounded white group, cut row by row so the list can page.
              <ListGroupCell first={index === 0} last={index === leads.length - 1}>
                <LeadRow lead={item} statuses={statuses} onPress={openLead} first={index === 0} selected={shownId === item.Id} />
              </ListGroupCell>
            )}
            ListEmptyComponent={
              // Placeholder rows are the previous preset's: no verdict on this one yet.
              isPlaceholderData ? (
                <SkeletonRows />
              ) : (
                <EmptyState
                  top
                  module="leads"
                  title={narrowed ? "Nothing matches" : EMPTY[queue].title}
                  message={narrowed ? "Try another status, or clear the search." : EMPTY[queue].message}
                />
              )
            }
          />
        )}
      </BandSheet>
    </View>
  );

  if (!isTwoPane) return <Screen band>{list}</Screen>;
  return (
    <Screen band style={styles.row}>
      {list}
      <View style={styles.fill}>
        {shownId != null ? (
          <LeadDetailBody key={shownId} leadId={shownId} navigation={navigation} useBar={inPane} pane />
        ) : (
          <BandSheet center gutter={metrics.pane.detailSheet}>
            <EmptyState module="leads" title="No lead selected" message="Pick a lead on the left to see it here." />
          </BandSheet>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: "row" },
  listPane: { flex: 0, width: metrics.listPaneWidth },
  pills: { marginBottom: spacing[3] },
  list: { paddingBottom: spacing[6] },
  listEmpty: { flexGrow: 1 },
});
