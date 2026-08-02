import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { MaterialIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { StackNavigationProp } from "@react-navigation/stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchTasks } from "../../api/taskQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import type { Task } from "../../types/api";
import { colors, radius, spacing } from "../../theme";
import { Dialog, EmptyState, Screen, Text } from "../../ui";
import { useSignOut } from "../auth/useSignOut";
import { TaskCard } from "./TaskCard";
import { greetingFor, longDate } from "./greeting";
import { BUCKET_LABEL, groupByDue, isAssignee, isUnassigned } from "./taskHelpers";

type Filter = "mine" | "unassigned" | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "mine", label: "Mine" },
  { key: "unassigned", label: "Unassigned" },
  { key: "all", label: "All" },
];

export default function MyWorkScreen() {
  const navigation =
    useNavigation<StackNavigationProp<RootStackParamList>>();
  const userId = useAuthStore((s) => s.UserId);
  const user = useAuthStore((s) => s.user);
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>("mine");
  const signOut = useSignOut();

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

  const openTask = useCallback(
    (task: Task) =>
      navigation.navigate("TaskDetail", {
        taskId: task.Id,
        workspaceId: task.WorkspaceId,
      }),
    [navigation],
  );

  const firstName = (user?.FullName ?? "").split(" ")[0] || "there";
  const greeting = greetingFor();

  return (
    <Screen>
      {/* Fixed — it is a header, not a list row. Only the tasks scroll. */}
      <View style={[styles.header, { paddingTop: insets.top + spacing[3] }]}>
        <View style={styles.headerTop}>
          <View style={styles.greetBlock}>
            <Text variant="secondary" color="textOnBrandMuted">
              {greeting.text}, {greeting.emoji}
            </Text>
            <Text variant="h1" color="textOnBrand">
              {firstName}
            </Text>
            <Text variant="caption" color="textOnBrandMuted">
              {longDate()}
            </Text>
          </View>
          {/* Sign-out lives here as well as on the profile tab: it is the one
              action people hunt for, and a decorative avatar was occupying the
              only obvious slot for it. */}
          <Pressable
            onPress={() => signOut.setConfirming(true)}
            accessibilityLabel="Sign out"
            accessibilityRole="button"
            hitSlop={spacing[2]}
            style={({ pressed }) => [
              styles.signOut,
              pressed && styles.signOutPressed,
            ]}
          >
            <MaterialIcons
              name="power-settings-new"
              size={20}
              color={colors.danger}
            />
          </Pressable>
        </View>

        <View style={styles.summaryRow}>
          <Text variant="secondary" color="textOnBrandMuted">
            {mineCount > 0
              ? `${mineCount} task${mineCount === 1 ? "" : "s"} assigned to you`
              : "Nothing assigned to you right now"}
          </Text>
        </View>

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
                  color={active ? "primary" : "textOnBrand"}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => String(item.Id)}
        contentContainerStyle={[
          styles.content,
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

      <Dialog
        visible={signOut.confirming}
        title="Sign out?"
        message="You will need your password to sign back in."
        confirmLabel="Sign out"
        destructive
        loading={signOut.busy}
        onConfirm={signOut.signOut}
        onCancel={() => signOut.setConfirming(false)}
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
  header: {
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[4],
    gap: spacing[4],
    backgroundColor: colors.primary,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
  },
  greetBlock: { flex: 1, gap: spacing[1] },
  signOut: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  signOutPressed: { backgroundColor: colors.surfaceMuted },
  summaryRow: {},
  // No top padding — the section header below provides the gap. Stacking
  // header padding, list padding and section padding gave 44px of dead space.
  content: { paddingBottom: spacing[10] },
  contentEmpty: { flexGrow: 1 },
  filters: { flexDirection: "row", gap: spacing[2] },
  // On the brand header the pills invert: selected is white, the rest are a
  // solid lighter brand shade.
  filter: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.surfaceOnBrand,
  },
  filterActive: { backgroundColor: colors.surface },
  sectionTitle: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
  },
  cardWrap: { paddingHorizontal: spacing[5], paddingBottom: spacing[3] },
});
