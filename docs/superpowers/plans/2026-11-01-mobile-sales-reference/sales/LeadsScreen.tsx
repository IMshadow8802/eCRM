import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { CloudOff, Plus, Search, TrendingUp } from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import { fetchLeads } from "../../api/leadQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import type { Lead } from "../../types/api";
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
import { LeadCard } from "./LeadCard";
import {
  LEAD_QUEUES,
  leadQueueParams,
  type LeadQueue,
  type LeadStatusFilter,
} from "./leadHelpers";
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

  const [queue, setQueue] = useState<LeadQueue>("mine");
  const [status, setStatus] = useState<LeadStatusFilter>("all");
  const [search, setSearch] = useState("");
  const term = useDeferredValue(search.trim());

  const params = useMemo(
    () => leadQueueParams(queue, status, userId, term),
    [queue, status, userId, term],
  );

  const leadsQuery = useQuery({
    queryKey: ["leads", params],
    queryFn: () => fetchLeads(params),
  });

  const { statuses } = useLeadRefData();
  const statusOptions = useMemo(
    () => [
      { value: "all" as LeadStatusFilter, label: "All" },
      ...statuses.map((s) => ({ value: s.Id as LeadStatusFilter, label: s.Value })),
    ],
    [statuses],
  );

  const leads = leadsQuery.data?.data?.leads ?? [];
  const total = leadsQuery.data?.data?.pagination.totalRecords ?? leads.length;
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
        <ChipGroup
          label="Filter by status"
          value={status}
          options={statusOptions}
          onChange={setStatus}
        />
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
        data={leads}
        keyExtractor={(lead) => String(lead.Id)}
        contentContainerStyle={[styles.list, !leads.length && styles.listEmpty]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <Refresher
            refreshing={leadsQuery.isRefetching && !leadsQuery.isLoading}
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
                leadsQuery.isError
                  ? "Couldn't load leads"
                  : narrowed
                    ? "Nothing matches"
                    : EMPTY[queue].title
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

      <Fab
        icon={Plus}
        accessibilityLabel="Add a lead"
        onPress={() => navigation.navigate("LeadForm", {})}
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
  list: { paddingTop: spacing[4], paddingBottom: spacing[20] },
  listEmpty: { flexGrow: 1 },
  cardWrap: { paddingHorizontal: SCREEN_PADDING, paddingBottom: spacing[5] },
});
