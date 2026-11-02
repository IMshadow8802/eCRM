import { useDeferredValue, useMemo, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, CalendarClock, CloudOff, Phone, Search } from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import { fetchFollowUps } from "../../api/followupQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import { colors, spacing, SCREEN_PADDING } from "../../theme";
import {
  Card,
  Chip,
  EmptyState,
  Input,
  Refresher,
  Screen,
  ScreenHeader,
  Segmented,
  Text,
} from "../../ui";
import {
  dayLabel,
  FOLLOWUP_VIEWS,
  followUpTypeLabel,
  followUpViewParams,
  type FollowUpView,
} from "./leadHelpers";

type Props = StackScreenProps<RootStackParamList, "FollowUps">;

const EMPTY: Record<FollowUpView, { title: string; message: string }> = {
  today: { title: "Nothing due today", message: "Follow-ups due today show up here." },
  overdue: { title: "Nothing overdue", message: "Every follow-up is on time." },
  upcoming: { title: "Nothing coming up", message: "Schedule one from a lead." },
  all: { title: "No follow-ups", message: "Schedule one from a lead." },
};

/**
 * The follow-up queue across every lead the caller can see — the morning
 * list. Logging happens on the lead, where the history is; a row opens it.
 */
export default function FollowUpsScreen({ navigation }: Props) {
  const [view, setView] = useState<FollowUpView>("today");
  const [search, setSearch] = useState("");
  const term = useDeferredValue(search.trim());

  const params = useMemo(
    () => ({ ...followUpViewParams(view), SearchTerm: term || null, PageSize: 100 }),
    [view, term],
  );

  const query = useQuery({
    queryKey: ["followups", params],
    queryFn: () => fetchFollowUps(params),
  });

  const rows = query.data?.data?.followups ?? [];
  const total = query.data?.data?.pagination.totalRecords ?? rows.length;

  return (
    <Screen>
      <ScreenHeader
        title="Follow-ups"
        subtitle={`${total} ${FOLLOWUP_VIEWS.find((v) => v.value === view)?.label.toLowerCase()}`}
        tint="success"
        onBack={navigation.goBack}
      />

      <View style={styles.controls}>
        <Segmented value={view} options={FOLLOWUP_VIEWS} onChange={setView} />
        <Input
          value={search}
          onChangeText={setSearch}
          placeholder="Lead name, company or mobile"
          leftIcon={Search}
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(f) => String(f.Id)}
        contentContainerStyle={[styles.list, !rows.length && styles.listEmpty]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <Refresher refreshing={query.isRefetching && !query.isLoading} onRefresh={query.refetch} />
        }
        renderItem={({ item: f }) => (
          <View style={styles.cardWrap}>
            <Card onPress={() => navigation.navigate("LeadDetail", { leadId: f.LeadId })}>
              <Text variant="h3" numberOfLines={1}>
                {f.LeadName ?? "Lead"}
              </Text>
              <View style={styles.row}>
                <Phone size={13} color={colors.textMuted} />
                <Text variant="caption" color="textSecondary" numberOfLines={1} style={styles.grow}>
                  {[f.LeadMobile, f.LeadCompany].filter(Boolean).join(" · ") || "No contact"}
                </Text>
              </View>
              <View style={styles.chips}>
                <Chip
                  label={`${followUpTypeLabel(f.Type)} · ${dayLabel(f.DueAt) ?? "—"}`}
                  icon={CalendarClock}
                  tone={f.IsOverdue ? "danger" : f.Status === "open" ? "primary" : "neutral"}
                />
                {f.Status !== "open" ? (
                  <Chip label={f.Status === "done" ? "Done" : "Skipped"} />
                ) : null}
                {f.LeadStatus ? <Chip label={f.LeadStatus} /> : null}
              </View>
              {f.AssignedToName ? (
                <Text variant="caption" color="textMuted">
                  {f.AssignedToName}
                </Text>
              ) : null}
            </Card>
          </View>
        )}
        ListEmptyComponent={
          query.isLoading ? null : (
            <EmptyState
              icon={query.isError ? CloudOff : CalendarCheck}
              title={query.isError ? "Couldn't load follow-ups" : term ? "Nothing matches" : EMPTY[view].title}
              message={query.isError ? "Pull down to try again." : term ? "Clear the search." : EMPTY[view].message}
            />
          )
        }
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
  row: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  grow: { flex: 1 },
  chips: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing[2] },
});
