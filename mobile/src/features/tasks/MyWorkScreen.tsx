import { useCallback, useMemo, useState } from "react";
import { Pressable, SectionList, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, CloudOff, Power } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { StackNavigationProp } from "@react-navigation/stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchTasks } from "../../api/taskQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import type { Task } from "../../types/api";
import {
  colors,
  radius,
  spacing,
  SCREEN_PADDING,
  TAB_BAR_CLEARANCE,
} from "../../theme";
import { ChipGroup, Dialog, EmptyState, Refresher, Screen, Text } from "../../ui";
import { useSignOut } from "../auth/useSignOut";
import { TaskCard } from "./TaskCard";
import { greetingFor, longDate } from "./greeting";
import { dueBucket, groupByDue, isAssignee, isUnassigned } from "./taskHelpers";

type Filter = "mine" | "unassigned" | "all";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "mine", label: "Mine" },
  { value: "unassigned", label: "Unassigned" },
  { value: "all", label: "All" },
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

  /**
   * Still grouped, but the group labels are gone — the buckets survive only to
   * ORDER the list, overdue first and undated last.
   *
   * The headers were dropped because the top one could never work: a section
   * header divides what is above it from what is below, and the first one has
   * nothing above it but the filter chips. The rest were mostly restating what
   * the card already says two lines down — "Overdue" over "108 days overdue".
   * The count that was worth keeping moved up to the summary line, where it is
   * visible without scrolling.
   */
  const sections = useMemo(
    () => groupByDue(visible).map((g) => ({ key: g.bucket, data: g.tasks })),
    [visible],
  );

  const mineCount = useMemo(
    () => tasks.filter((t) => isAssignee(t, userId)).length,
    [tasks, userId],
  );

  // Counted off what is ON SCREEN, not off `tasks` — with the Unassigned or All
  // filter up, a figure from a set the user cannot see is worse than none.
  const overdueCount = useMemo(
    () => visible.filter((t) => !t.IsCompleted && dueBucket(t.DueDate) === "overdue").length,
    [visible],
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
            <Text variant="secondary">
              {greeting.text}, {greeting.emoji}
            </Text>
            <Text variant="h1">{firstName}</Text>
            <Text variant="caption" color="textMuted">
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
            <Power
              size={20}
              color={colors.danger}
            />
          </Pressable>
        </View>

        <View style={styles.summaryRow}>
          <Text variant="secondary">
            {mineCount > 0
              ? `${mineCount} task${mineCount === 1 ? "" : "s"} assigned to you`
              : "Nothing assigned to you right now"}
          </Text>
          {/* Split out in red rather than buried in the sentence: the count of
              things already late is the one number on this screen worth acting
              on, and it was previously only discoverable by scrolling. */}
          {overdueCount > 0 ? (
            <Text variant="secondary" color="danger">
              {" · "}
              {overdueCount} overdue
            </Text>
          ) : null}
        </View>

        <ChipGroup
          label="Filter tasks"
          value={filter}
          options={FILTERS}
          onChange={setFilter}
        />
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => String(item.Id)}
        contentContainerStyle={[
          styles.content,
          !sections.length && styles.contentEmpty,
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <Refresher refreshing={isRefetching && !isLoading} onRefresh={refetch} />
        }
        renderItem={({ item }) => (
          <View style={styles.cardWrap}>
            <TaskCard task={item} onPress={openTask} />
          </View>
        )}
        ListEmptyComponent={
          isLoading ? null : (
            <EmptyState
              icon={isError ? CloudOff : ClipboardCheck}
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
    paddingHorizontal: SCREEN_PADDING,
    paddingBottom: spacing[3],
    gap: spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
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
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  signOutPressed: { backgroundColor: colors.surfacePressed },
  summaryRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  // The gap the section header used to provide, now that there is none.
  content: { paddingTop: spacing[4], paddingBottom: TAB_BAR_CLEARANCE },
  contentEmpty: { flexGrow: 1 },
  // 16, matching the board columns: the gap has to out-reach the card shadow
  // or stacked shadows meet and the list reads as one grey slab.
  cardWrap: { paddingHorizontal: SCREEN_PADDING, paddingBottom: spacing[5] },
});
