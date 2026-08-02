import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchTasks } from "../../api/taskQueries";
import useAuthStore from "../../stores/useAuthStore";
import type { Task } from "../../types/api";
import { colors, radius, spacing } from "../../theme";
import { EmptyState, PageHeader, Screen, Text } from "../../ui";
import { TaskCard } from "./TaskCard";
import { BUCKET_LABEL, groupByDue, isAssignee, isUnassigned } from "./taskHelpers";

type Filter = "mine" | "unassigned" | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "mine", label: "Mine" },
  { key: "unassigned", label: "Unassigned" },
  { key: "all", label: "All" },
];

export default function MyWorkScreen() {
  const userId = useAuthStore((s) => s.UserId);
  const user = useAuthStore((s) => s.user);
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>("mine");

  // WorkspaceId: null = every workspace the caller can see. sp_FetchTask has no
  // assignee parameter, so "assigned to me" is resolved on the client from each
  // row's AssigneesJson. Fine at this scale; see spec §5.1 for the ceiling and
  // the upgrade path.
  const { data, isLoading, isRefetching, refetch, isError } = useQuery({
    queryKey: ["tasks", "all-workspaces"],
    queryFn: () => fetchTasks({ WorkspaceId: null, PageSize: 200 }),
  });

  const tasks = useMemo(() => data?.data?.tasks ?? [], [data]);

  const visible = useMemo(() => {
    if (filter === "mine") return tasks.filter((t) => isAssignee(t, userId));
    if (filter === "unassigned") return tasks.filter(isUnassigned);
    return tasks;
  }, [tasks, filter, userId]);

  const sections = useMemo(
    () =>
      groupByDue(visible).map((g) => ({
        title: BUCKET_LABEL[g.bucket],
        data: g.tasks,
      })),
    [visible],
  );

  const mineCount = useMemo(
    () => tasks.filter((t) => isAssignee(t, userId)).length,
    [tasks, userId],
  );

  const openTask = useCallback((task: Task) => {
    // Phase 2 continues: push the task detail screen.
    void task;
  }, []);

  const firstName = (user?.FullName ?? "").split(" ")[0] || "there";

  return (
    <Screen>
      <SectionList
        sections={sections}
        keyExtractor={(item) => String(item.Id)}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing[4] },
          !sections.length && styles.contentEmpty,
        ]}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && !isLoading}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <PageHeader
            eyebrow={`Hi ${firstName}`}
            title="My Work"
            subtitle={
              mineCount > 0
                ? `${mineCount} task${mineCount === 1 ? "" : "s"} assigned to you`
                : "Nothing assigned to you right now"
            }
          >
            <View style={styles.filters}>
              {FILTERS.map((f) => {
                const active = f.key === filter;
                return (
                  <Pressable
                    key={f.key}
                    onPress={() => setFilter(f.key)}
                    style={[styles.filter, active && styles.filterActive]}
                  >
                    <Text
                      variant="label"
                      color={active ? "textOnBrand" : "textSecondary"}
                    >
                      {f.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </PageHeader>
        }
        renderSectionHeader={({ section }) => (
          <Text variant="overline" color="textMuted" style={styles.sectionTitle}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <View style={styles.cardWrap}>
            <TaskCard task={item} onPress={openTask} />
          </View>
        )}
        ListEmptyComponent={
          isLoading ? null : (
            <EmptyState
              icon={isError ? "cloud-off" : "check-circle-outline"}
              title={isError ? "Couldn't load your tasks" : emptyTitle(filter)}
              message={
                isError ? "Pull down to try again." : emptyMessage(filter)
              }
            />
          )
        }
      />
    </Screen>
  );
}

const emptyTitle = (filter: Filter) =>
  filter === "mine"
    ? "Nothing assigned to you"
    : filter === "unassigned"
      ? "Nothing unassigned"
      : "No tasks yet";

const emptyMessage = (filter: Filter) =>
  filter === "mine"
    ? "Tasks assigned to you across every workspace show up here."
    : filter === "unassigned"
      ? "Every task on your boards has someone on it."
      : "Tasks from all your workspaces will appear here.";

const styles = StyleSheet.create({
  content: { paddingBottom: spacing[10] },
  contentEmpty: { flexGrow: 1 },
  filters: { flexDirection: "row", gap: spacing[2] },
  filter: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
  },
  filterActive: { backgroundColor: colors.primary },
  sectionTitle: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[5],
    paddingBottom: spacing[2],
  },
  cardWrap: { paddingHorizontal: spacing[5], paddingBottom: spacing[3] },
});
