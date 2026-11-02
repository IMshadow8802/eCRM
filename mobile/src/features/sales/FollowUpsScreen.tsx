import { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowRight, Calendar, CalendarClock, Check, Search } from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import { fetchFollowUps, type FetchFollowUpsParams } from "../../api/followupQueries";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useParamState } from "../../hooks/useParamState";
import { overdueFollowUpsCountQuery } from "../../navigation/badges";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import type { FollowUp } from "../../types/api";
import { followUpBadge } from "../../theme/statusBadges";
import { metrics, spacing } from "../../theme";
import {
  Band,
  BandSheet,
  Chip,
  DateField,
  EmptyState,
  ErrorCard,
  Footnote,
  GroupHeader,
  IconButton,
  ListGroup,
  ListGroupCell,
  ListRow,
  Refresher,
  Screen,
  SegmentedTabs,
  SkeletonRows,
  SwipeRow,
  Text,
  useLayout,
} from "../../ui";
import { useAccess } from "../auth/useAccess";
import { FollowUpSheets, type FollowUpSheetsHandle } from "./FollowUpSheets";
import {
  clock,
  doneTodayParams,
  FOLLOWUP_VIEWS,
  followUpTypeLabel,
  followUpViewParams,
  localDay,
  parseDate,
  shortDay,
  type FollowUpView,
} from "./leadHelpers";

/**
 * A tab for a leads-only role; pushed from More (with a back button) when the
 * bar has no room for it.
 */
type Props = StackScreenProps<RootStackParamList, "FollowUps"> & { pushed?: boolean };

const EMPTY: Record<FollowUpView, { title: string; message: string }> = {
  today: { title: "Nothing due today", message: "Follow-ups due today show up here." },
  overdue: { title: "Nothing overdue", message: "Every follow-up is on time." },
  upcoming: { title: "Nothing coming up", message: "Schedule one from a lead." },
  all: { title: "No follow-ups", message: "Schedule one from a lead." },
};

const count = (q: { data?: { data?: { pagination?: { totalRecords?: number } } | null } }) =>
  q.data?.data?.pagination?.totalRecords;

/** The right-hand time: the clock on today's rows, else the day (and the clock when there is one). */
function when(f: FollowUp, now = new Date()): string {
  const d = parseDate(f.Status === "open" ? f.DueAt : (f.DoneAt ?? f.DueAt));
  if (!d) return "—";
  if (localDay(d) === localDay(now)) return clock(d);
  return d.getHours() || d.getMinutes() ? `${shortDay(d)} ${clock(d)}` : shortDay(d);
}

/**
 * The follow-up queue across every lead the caller can see (E 17): Today ·
 * Overdue · Upcoming · All (§7.3), each row's Done pill and swipes (right =
 * done, left = reschedule; a swipe only reveals, the block opens a sheet),
 * and on Today the ones already done today (G20, needs SQL 118).
 */
export default function FollowUpsScreen({ navigation, route, pushed = false }: Props) {
  const { gutter } = useLayout();
  const can = useAccess("leads");
  const sheets = useRef<FollowUpSheetsHandle>(null);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [picking, setPicking] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  // "Today" unless a navigate() asks for another view — which also clears a
  // search or picked day left on this mounted tab, so the list is what Home counted.
  const [view, setView] = useParamState<FollowUpView>(route.params, route.params?.view, "today", () => {
    setSearch("");
    setDay(null);
  });
  const term = useDebouncedValue(search.trim());

  // A picked day (the band's calendar) replaces the view: every follow-up due that day.
  const params: FetchFollowUpsParams = useMemo(
    () => ({ ...(day ? { DueFrom: day, DueTo: day } : followUpViewParams(view)), SearchTerm: term || null, PageSize: 50 }),
    [view, day, term],
  );

  // Pages of 50, fetched as the list nears its end (as Leads and Complaints).
  const query = useInfiniteQuery({
    queryKey: ["followups", "list", params],
    queryFn: ({ pageParam }) => fetchFollowUps({ ...params, PageNumber: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (all.length < (last.data?.pagination.totalPages ?? 0) ? all.length + 1 : undefined),
    // The old rows stay up while a new view or search loads.
    placeholderData: keepPreviousData,
  });

  const todayParams = followUpViewParams("today");
  const todayCount = useQuery({
    queryKey: ["followups", "count", todayParams],
    queryFn: () => fetchFollowUps({ ...todayParams, PageSize: 1 }),
  });
  // The bar's overdue badge: one request for both.
  const overdueCount = useQuery(overdueFollowUpsCountQuery());
  const showDone = view === "today" && !day && !term;
  const doneParams = doneTodayParams();
  // G20: a DB without SQL 118 refuses DoneFrom/DoneTo; the group then reads "—".
  const doneToday = useQuery({
    queryKey: ["followups", "done-today", doneParams],
    queryFn: () => fetchFollowUps({ ...doneParams, PageSize: 50 }),
    enabled: showDone,
    // Without 118 it can never succeed; retrying only delays the "—".
    retry: false,
  });

  // Offset paging: a row that shifts mid-scroll can land on two pages.
  const rows = useMemo(() => {
    const seen = new Set<number>();
    return (query.data?.pages.flatMap((page) => page.data?.followups ?? []) ?? []).filter(
      (f) => !seen.has(f.Id) && seen.add(f.Id),
    );
  }, [query.data]);

  const { hasNextPage, isFetchingNextPage, isPlaceholderData, fetchNextPage } = query;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isPlaceholderData) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isPlaceholderData, fetchNextPage]);

  const left = count(todayCount);
  const now = new Date();
  const meta = `${shortDay(now)} · ${left == null ? "—" : left} ${left === 1 ? "call or visit" : "calls and visits"} left today`;

  const openLead = (f: FollowUp) => navigation.navigate("LeadDetail", { leadId: f.LeadId });

  const row = (f: FollowUp, index: number, last: boolean) => {
    const open = f.Status === "open";
    const badge = followUpBadge(f.Type, open ? (f.IsOverdue ? "overdue" : "open") : f.Status === "done" ? "done" : "open");
    const actionable = open && can.edit;
    const body = (
      <ListRow
        badge={{ tone: f.Status === "skipped" ? "slate" : badge.tone, icon: badge.icon }}
        title={f.LeadName ?? "Lead"}
        titleTone={open ? "default" : "muted"}
        right={{ text: when(f, now), tone: open && f.IsOverdue ? "danger" : "default" }}
        meta={[followUpTypeLabel(f.Type), f.LeadCompany, f.Remarks].filter(Boolean).join(" · ")}
        trailing={
          actionable ? (
            <Chip label="Done" icon={Check} tone="green" size="lg" accessibilityLabel={`Mark ${f.LeadName ?? "it"} done`} onPress={() => sheets.current?.done(f)} />
          ) : !open ? (
            <Chip label={f.Status === "done" ? "Done" : "Skipped"} tone="slate" />
          ) : null
        }
        noSeparator={index === 0}
        onPress={() => openLead(f)}
        testID={`followup-row-${f.Id}`}
      />
    );
    return (
      <ListGroupCell key={f.Id} first={index === 0} last={last}>
        {actionable ? (
          <SwipeRow
            left={[{ key: "done", label: "Done", icon: Check, color: "success", onPress: () => sheets.current?.done(f) }]}
            right={[{ key: "reschedule", label: "Reschedule", icon: CalendarClock, color: "primary", onPress: () => sheets.current?.reschedule(f) }]}
          >
            {body}
          </SwipeRow>
        ) : (
          body
        )}
      </ListGroupCell>
    );
  };

  const done = doneToday.data?.data?.followups ?? [];
  const header = (
    <View style={styles.header}>
      <SegmentedTabs
        value={day ? ("" as FollowUpView) : view}
        onChange={(v) => {
          setDay(null);
          setView(v);
        }}
        options={FOLLOWUP_VIEWS.map((v) => ({
          value: v.value,
          label: v.label,
          count: v.value === "today" ? left : v.value === "overdue" ? count(overdueCount) : undefined,
          countTone: v.value === "overdue" ? ("danger" as const) : undefined,
        }))}
      />
      {picking ? (
        <View style={styles.pick}>
          <DateField label="Due on" value={day} onChange={setDay} placeholder="Pick a day" clearable />
        </View>
      ) : null}
    </View>
  );
  const footer = (
    <>
      {showDone ? (
        <>
          {/* "—" only once it has failed (no 118); while it loads the title carries no number. */}
          <GroupHeader title={doneToday.isError ? "Done today · —" : doneToday.data ? `Done today · ${count(doneToday) ?? 0}` : "Done today"} />
          {done.length ? (
            <ListGroup>
              {done.map((f, i) => (
                <ListRow
                  key={f.Id}
                  badge={{ tone: "green", icon: Check }}
                  title={f.LeadName ?? "Lead"}
                  titleTone="muted"
                  right={{ text: when(f, now) }}
                  meta={[followUpTypeLabel(f.Type), f.LeadCompany].filter(Boolean).join(" · ")}
                  noSeparator={i === 0}
                  onPress={() => openLead(f)}
                />
              ))}
            </ListGroup>
          ) : null}
        </>
      ) : null}
      {can.edit && rows.some((f) => f.Status === "open") ? (
        <Footnote icon={ArrowRight}>Swipe a row right to mark it done, left to reschedule.</Footnote>
      ) : null}
    </>
  );

  const pad = { paddingTop: metrics.sheetPadTop, paddingHorizontal: gutter };

  return (
    <Screen band>
      <Band
        variant="record"
        title="Follow-ups"
        onBack={pushed ? navigation.goBack : undefined}
        search={searching ? { value: search, onChangeText: setSearch, placeholder: "Lead name, company or mobile", autoFocus: true } : undefined}
        actions={
          <View style={styles.bandActions}>
            <IconButton
              icon={Search}
              accessibilityLabel={searching ? "Close search" : "Search follow-ups"}
              onPress={() => {
                if (searching) setSearch("");
                setSearching(!searching);
              }}
            />
            <IconButton
              icon={Calendar}
              accessibilityLabel="Pick a day"
              onPress={() => {
                if (picking) setDay(null);
                setPicking(!picking);
              }}
            />
          </View>
        }
      >
        <Text variant="meta" color="onBandMuted" tabular>{meta}</Text>
      </Band>

      <BandSheet padded={false}>
        {query.isError && !rows.length ? (
          <View style={pad}>
            {header}
            <ErrorCard onRetry={() => void query.refetch()} />
          </View>
        ) : query.isLoading ? (
          <View style={pad}>
            {header}
            <SkeletonRows />
          </View>
        ) : (
          <FlatList
            testID="followups-list"
            data={rows}
            keyExtractor={(f) => String(f.Id)}
            contentContainerStyle={[pad, styles.list]}
            ListHeaderComponent={header}
            ListFooterComponent={footer}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            refreshControl={
              // A view switch or search refetches too; only a pull spins.
              <Refresher refreshing={query.isRefetching && !isPlaceholderData && !isFetchingNextPage} onRefresh={query.refetch} />
            }
            renderItem={({ item, index }) => row(item, index, index === rows.length - 1)}
            ListEmptyComponent={
              // Placeholder rows belong to the previous view: no verdict on this one yet.
              isPlaceholderData ? null : (
                <View style={styles.empty}>
                  <EmptyState
                    module="followups"
                    title={term ? "Nothing matches" : day ? "Nothing due that day" : EMPTY[view].title}
                    message={term ? "Clear the search." : day ? "Pick another day." : EMPTY[view].message}
                  />
                </View>
              )
            }
          />
        )}
      </BandSheet>

      {can.edit ? <FollowUpSheets ref={sheets} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bandActions: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  header: { marginBottom: spacing[3] },
  pick: { marginTop: spacing[3] },
  list: { paddingBottom: spacing[6] },
  empty: { paddingVertical: spacing[10] },
});
