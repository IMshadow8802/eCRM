import { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Columns3,
  Plus,
  Settings,
} from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import { fetchKanbanColumns } from "../../api/kanbanQueries";
import { fetchTasks, moveTaskColumn } from "../../api/taskQueries";
import { fetchWorkspaces } from "../../api/workspaceQueries";
import { apiErrorMessage } from "../../api/errors";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import type { KanbanColumn, Task } from "../../types/api";
import { colors, radius, spacing } from "../../theme";
import {
  ActionSheet,
  BoardColumns,
  EmptyState,
  Fab,
  Refresher,
  Screen,
  ScreenHeader,
  Text,
  type SheetAction,
  type SheetRef,
  useToast,
} from "../../ui";
import { TaskCard } from "../tasks/TaskCard";
import { abilitiesFor } from "../tasks/taskHelpers";

type Props = StackScreenProps<RootStackParamList, "Board">;

/** Tasks whose ColumnId is null still have to live somewhere visible. */
const UNSORTED_ID = -1;

/**
 * One workspace's kanban.
 *
 * There is no drag between columns and there will not be: four columns on a
 * 360px screen makes each drop target a few pixels wide. Long-press a card,
 * pick a column, done — same `moveTaskColumn` call, same `change_status` gate,
 * and it works one-handed.
 */
export default function BoardScreen({ route, navigation }: Props) {
  const { workspaceId, name } = route.params;
  const queryClient = useQueryClient();
  const toast = useToast();
  const userId = useAuthStore((s) => s.UserId);
  const isAdmin = useAuthStore((s) => Boolean(s.user?.IsAdmin));

  const [moving, setMoving] = useState<Task | null>(null);
  const [columnIndex, setColumnIndex] = useState(0);
  const moveRef = useRef<SheetRef>(null);

  const columnsQuery = useQuery({
    queryKey: ["columns", workspaceId],
    queryFn: () => fetchKanbanColumns({ WorkspaceId: workspaceId }),
  });

  const tasksQuery = useQuery({
    queryKey: ["tasks", "board", workspaceId],
    queryFn: () => fetchTasks({ WorkspaceId: workspaceId, PageSize: 200 }),
  });

  const { data: workspaces } = useQuery({
    queryKey: ["workspaces", false],
    queryFn: () => fetchWorkspaces({ PageSize: 100 }),
  });

  const workspace = workspaces?.find((w) => w.Id === workspaceId);
  const role = workspace?.MyRole ?? null;
  const manages = role === "owner" || role === "manager";

  const move = useMutation({
    mutationFn: moveTaskColumn,
    // Clearing `moving` here too, not just on success. The move sheet is driven
    // by that state, so a refused move used to leave it pinned open on a card
    // that had not gone anywhere, with nothing said about why.
    onError: (err) => {
      setMoving(null);
      toast.error(apiErrorMessage(err, "Could not move that task."));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setMoving(null);
    },
  });

  const tasks = useMemo(
    () => tasksQuery.data?.data?.tasks ?? [],
    [tasksQuery.data],
  );

  // An "Unsorted" column only exists when something is actually in it — an
  // empty extra column on a small screen is a wasted swipe.
  const columns = useMemo(() => {
    const real = columnsQuery.data ?? [];
    const orphans = tasks.some(
      (t) => t.ColumnId == null || !real.some((c) => c.Id === t.ColumnId),
    );
    if (!orphans) return real;
    const unsorted = {
      Id: UNSORTED_ID,
      Title: "Unsorted",
      Color: null,
    } as KanbanColumn;
    return [...real, unsorted];
  }, [columnsQuery.data, tasks]);

  const byColumn = useMemo(() => {
    const known = new Set(columns.map((c) => c.Id));
    const map = new Map<number, Task[]>();
    for (const column of columns) map.set(column.Id, []);
    for (const task of tasks) {
      const key =
        task.ColumnId != null && known.has(task.ColumnId)
          ? task.ColumnId
          : UNSORTED_ID;
      map.get(key)?.push(task);
    }
    return map;
  }, [columns, tasks]);

  const openTask = useCallback(
    (task: Task) =>
      navigation.navigate("TaskDetail", { taskId: task.Id, workspaceId }),
    [navigation, workspaceId],
  );

  const promptMove = useCallback((task: Task) => {
    setMoving(task);
    moveRef.current?.present();
  }, []);

  // Permission is per-task: an assignee may move their own card even though
  // they may not move anyone else's. The server re-checks either way.
  const canMove = moving
    ? abilitiesFor(moving, userId, role, isAdmin).changeStatus
    : false;

  const moveActions: SheetAction[] = canMove
    ? columns
        .filter((c) => c.Id !== UNSORTED_ID)
        .map((column) => ({
          key: String(column.Id),
          label: column.Title,
          icon: ArrowRightLeft,
          selected: moving?.ColumnId === column.Id,
          onPress: () =>
            moving &&
            move.mutate({
              TaskId: moving.Id,
              ColumnId: column.Id,
              WorkspaceId: workspaceId,
            }),
        }))
    : [];

  const loading = columnsQuery.isLoading || tasksQuery.isLoading;
  const target = columns[columnIndex];

  return (
    <Screen>
      <ScreenHeader
        title={workspace?.Name ?? name}
        subtitle={`${tasks.length} task${tasks.length === 1 ? "" : "s"} · ${columns.length} column${columns.length === 1 ? "" : "s"}`}
        onBack={navigation.goBack}
        actions={
          manages
            ? [
                {
                  icon: Columns3,
                  label: "Manage columns",
                  onPress: () => navigation.navigate("Columns", { workspaceId }),
                },
                {
                  icon: Settings,
                  label: "Workspace settings",
                  onPress: () =>
                    navigation.navigate("WorkspaceSettings", { workspaceId }),
                },
              ]
            : undefined
        }
      />

      {!loading && !columns.length ? (
        <EmptyState
          icon={Columns3}
          title="This board has no columns"
          message={
            manages
              ? "Add a column to start placing tasks."
              : "Ask the board's owner to set up its columns."
          }
          actionLabel={manages ? "Manage columns" : undefined}
          onAction={
            manages
              ? () => navigation.navigate("Columns", { workspaceId })
              : undefined
          }
        />
      ) : (
        <BoardColumns
          columns={columns}
          keyOf={(column) => String(column.Id)}
          onSettle={setColumnIndex}
          renderColumn={(column) => {
            const cards = byColumn.get(column.Id) ?? [];
            return (
              <>
                <View style={styles.columnHeader}>
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: column.Color ?? colors.primary },
                    ]}
                  />
                  <Text variant="h3" numberOfLines={1} style={styles.columnTitle}>
                    {column.Title}
                  </Text>
                  <View style={styles.count}>
                    <Text variant="caption" color="textSecondary">
                      {cards.length}
                    </Text>
                  </View>
                </View>

                <FlatList
                  data={cards}
                  keyExtractor={(task) => String(task.Id)}
                  contentContainerStyle={styles.cards}
                  showsVerticalScrollIndicator={false}
                  // Pull-to-refresh belongs on the vertical list. A
                  // RefreshControl on the horizontal one never fires — the
                  // gesture it listens for is the one that scrolls the column.
                  refreshControl={
                    <Refresher
                      refreshing={tasksQuery.isRefetching && !loading}
                      onRefresh={tasksQuery.refetch}
                    />
                  }
                  ListEmptyComponent={
                    <Text variant="secondary" style={styles.columnEmpty}>
                      Nothing here yet.
                    </Text>
                  }
                  renderItem={({ item }) => (
                    <TaskCard
                      task={item}
                      onPress={openTask}
                      onLongPress={promptMove}
                      showWorkspace={false}
                    />
                  )}
                />
              </>
            );
          }}
        />
      )}

      {columns.length ? (
        <Fab
          icon={Plus}
          accessibilityLabel="Add a task to this column"
          onPress={() =>
            navigation.navigate("TaskForm", {
              workspaceId,
              columnId:
                target && target.Id !== UNSORTED_ID ? target.Id : null,
            })
          }
        />
      ) : null}

      <ActionSheet
        ref={moveRef}
        title={canMove ? "Move to column" : "Cannot move this task"}
        actions={moveActions}
        emptyMessage="You can only move tasks assigned to you, unless you manage this board."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  columnHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[1],
    paddingBottom: spacing[3],
  },
  dot: { width: 10, height: 10, borderRadius: radius.full },
  columnTitle: { flex: 1 },
  count: {
    minWidth: 26,
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: "center",
  },
  // Clears the FAB so the last card in a full column stays reachable.
  // Cards on a board carry no shadow (see ui/boardSurface), so this gap is
  // pure breathing room rather than shadow clearance.
  cards: { gap: spacing[5], paddingBottom: spacing[20] },
  columnEmpty: { paddingHorizontal: spacing[1] },
});
