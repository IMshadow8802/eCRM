import { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Columns3, EllipsisVertical, Plus, Search, Settings, X } from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import { fetchKanbanColumns } from "../../api/kanbanQueries";
import { fetchTasks, moveTaskColumn } from "../../api/taskQueries";
import { apiErrorMessage } from "../../api/errors";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import { colors, HIT_TARGET, metrics, radius, spacing, taskStageBadge, type TaskStage } from "../../theme";
import type { KanbanColumn, Task } from "../../types/api";
import {
  ActionSheet, Band, BandSheet, BOARD_GAP, BoardColumns, EmptyState, IconButton, PageDots, Refresher, Screen, StatusBadge, Text,
  useToast, type SheetAction, type SheetRef,
} from "../../ui";
import { TaskCard } from "../tasks/TaskCard";
import { abilitiesFor, boardQuery, WORKSPACES_QUERY, workspaceAbilities } from "../tasks/taskHelpers";

type Props = StackScreenProps<RootStackParamList, "Board">;
type TasksReply = Awaited<ReturnType<typeof fetchTasks>>;

/** Tasks whose ColumnId is null still have to live somewhere visible. */
const UNSORTED_ID = -1;
const TYPE_LABEL = { personal: "Personal", shared: "Shared", project: "Project" } as const;

/**
 * One workspace's kanban (E 07): columns in the band as tabs, each column a
 * sunken panel with a stage badge (G8), its cards, and "Add task".
 *
 * There is no drag between columns and there will not be: long-press a card,
 * pick a column — same `moveTaskColumn` call, same gate, one-handed.
 */
export default function BoardScreen({ route, navigation }: Props) {
  const { workspaceId, name } = route.params;
  const queryClient = useQueryClient();
  const toast = useToast();
  const userId = useAuthStore((s) => s.UserId);
  const isAdmin = useAuthStore((s) => Boolean(s.access?.isAdmin));

  const [moving, setMoving] = useState<Task | null>(null);
  const [columnIndex, setColumnIndex] = useState(0);
  const moveRef = useRef<SheetRef>(null);
  const menuRef = useRef<SheetRef>(null);

  const columnsQuery = useQuery({
    queryKey: ["columns", workspaceId],
    queryFn: () => fetchKanbanColumns({ WorkspaceId: workspaceId }),
  });

  const [searching, setSearching] = useState(false);
  const [search, setSearch] = useState("");
  // A real debounce: each settled term is a 200-row fetch.
  const term = useDebouncedValue(search.trim());
  // No search = the same key TaskDetail and Columns read.
  const board = boardQuery(workspaceId, term);
  const tasksKey = board.queryKey;
  // The last list stays up while a search loads — no flash of empty columns.
  const tasksQuery = useQuery({ ...board, placeholderData: keepPreviousData });

  const { data: workspaces } = useQuery(WORKSPACES_QUERY);
  const workspace = workspaces?.find((w) => w.Id === workspaceId);
  const role = workspace?.MyRole ?? null;
  const wsAbilities = workspaceAbilities(role, isAdmin, workspace?.Type ?? null);
  const manages = wsAbilities.manageColumns;

  // Optimistic: the card jumps columns at once and back if the server refuses.
  const move = useMutation({
    mutationFn: moveTaskColumn,
    onMutate: async (vars) => {
      const key = tasksKey;
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TasksReply>(key);
      queryClient.setQueryData<TasksReply>(key, (old) =>
        old?.data
          ? { ...old, data: { ...old.data, tasks: old.data.tasks.map((t) => (t.Id === vars.TaskId ? { ...t, ColumnId: vars.ColumnId } : t)) } }
          : old,
      );
      setMoving(null);
      return { key, previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx) queryClient.setQueryData(ctx.key, ctx.previous);
      setMoving(null);
      toast.error(apiErrorMessage(err, "Could not move that task."));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const tasks = useMemo(() => tasksQuery.data?.data?.tasks ?? [], [tasksQuery.data]);

  // An "Unsorted" column only exists when something is actually in it.
  const columns = useMemo(() => {
    const real = columnsQuery.data ?? [];
    const orphans = tasks.some((t) => t.ColumnId == null || !real.some((c) => c.Id === t.ColumnId));
    if (!orphans) return real;
    return [...real, { Id: UNSORTED_ID, Title: "Unsorted", Color: null } as KanbanColumn];
  }, [columnsQuery.data, tasks]);
  const real = columns.filter((c) => c.Id !== UNSORTED_ID);

  const byColumn = useMemo(() => {
    const known = new Set(columns.map((c) => c.Id));
    const map = new Map<number, Task[]>(columns.map((c) => [c.Id, []]));
    for (const task of tasks) map.get(task.ColumnId != null && known.has(task.ColumnId) ? task.ColumnId : UNSORTED_ID)?.push(task);
    return map;
  }, [columns, tasks]);

  const openTask = useCallback(
    (task: Task) => navigation.navigate("TaskDetail", { taskId: task.Id, workspaceId }),
    [navigation, workspaceId],
  );
  const promptMove = useCallback((task: Task) => {
    setMoving(task);
    moveRef.current?.present();
  }, []);

  // Per task: an assignee may move their own card. The server re-checks.
  const canMove = moving ? abilitiesFor(moving, userId, role, isAdmin, workspace?.Type ?? null).changeStatus : false;
  const moveActions: SheetAction[] = canMove
    ? real.map((column) => ({
      key: String(column.Id),
      label: column.Title,
      icon: ArrowRightLeft,
      selected: moving?.ColumnId === column.Id,
      onPress: () => moving && move.mutate({ TaskId: moving.Id, ColumnId: column.Id, WorkspaceId: workspaceId }),
    }))
    : [];
  const menuActions: SheetAction[] = [
    ...(manages
      ? [{ key: "columns", label: "Manage columns", icon: Columns3, onPress: () => navigation.navigate("Columns", { workspaceId }) }]
      : []),
    // Every member gets settings (roster + Leave); columns are managers'.
    ...(manages || role != null
      ? [{ key: "settings", label: "Workspace settings", icon: Settings, onPress: () => navigation.navigate("WorkspaceSettings", { workspaceId }) }]
      : []),
  ];

  /**
   * A new task is open, so adding from the last column lands it in the first
   * (sp_SaveTask would re-place it there anyway); from Unsorted the server picks.
   */
  const landingFor = (column: KanbanColumn) =>
    column.Id === UNSORTED_ID ? null : real.length > 1 && column.Id === real[real.length - 1]!.Id ? real[0]! : column;
  const addTo = (column: KanbanColumn) =>
    navigation.navigate("TaskForm", { workspaceId, columnId: landingFor(column)?.Id ?? null });

  /** G8 by position: first = to do, last = done once every card in it is, else in progress. */
  const stageOf = (column: KanbanColumn, cards: Task[]): TaskStage => {
    const i = real.findIndex((c) => c.Id === column.Id);
    if (i <= 0) return "todo";
    if (i === real.length - 1 && cards.length > 0 && cards.every((t) => t.IsCompleted)) return "done";
    return "inProgress";
  };

  const loading = columnsQuery.isLoading || tasksQuery.isLoading;
  const members = workspace?.MemberCount;
  const subtitle = workspace
    ? [
      TYPE_LABEL[workspace.Type],
      members != null ? `${members} member${members === 1 ? "" : "s"}` : null,
      role ? `you are ${role}` : null,
    ].filter(Boolean).join(" · ")
    : undefined;

  return (
    <Screen band>
      <Band
        variant="tabs"
        titleVariant="h2"
        title={workspace?.Name ?? name}
        subtitle={subtitle}
        onBack={navigation.goBack}
        actions={
          <>
            <IconButton
              icon={searching ? X : Search}
              accessibilityLabel={searching ? "Close search" : "Search this board"}
              onPress={() => {
                if (searching) setSearch("");
                setSearching(!searching);
              }}
            />
            {menuActions.length ? (
              <IconButton icon={EllipsisVertical} accessibilityLabel="Board options" onPress={() => menuRef.current?.present()} />
            ) : null}
          </>
        }
        search={searching ? { placeholder: "Search this board", value: search, onChangeText: setSearch, autoFocus: true } : undefined}
        tabs={
          columns.length
            ? {
              value: String(columns[Math.min(columnIndex, columns.length - 1)]!.Id),
              // A tap pages the strip (BoardColumns `index`); a swipe moves the tab.
              onChange: (v) => setColumnIndex(columns.findIndex((c) => String(c.Id) === v)),
              options: columns.map((c) => ({ value: String(c.Id), label: c.Title, count: byColumn.get(c.Id)?.length ?? 0 })),
            }
            : undefined
        }
      />

      {!loading && !columns.length ? (
        <BandSheet center>
          <EmptyState
            module="tasks"
            icon={Columns3}
            title="This board has no columns"
            message={manages ? "Add a column to start placing tasks." : "Ask the board's owner to set up its columns."}
            actionLabel={manages ? "Manage columns" : undefined}
            onAction={manages ? () => navigation.navigate("Columns", { workspaceId }) : undefined}
          />
        </BandSheet>
      ) : (
        <BandSheet bleedRight>
          <View style={styles.flex}>
            <BoardColumns
              columns={columns}
              insetLeft={0}
              keyOf={(column) => String(column.Id)}
              index={Math.min(columnIndex, Math.max(columns.length - 1, 0))}
              onSettle={setColumnIndex}
              renderColumn={(column) => {
                const cards = byColumn.get(column.Id) ?? [];
                const stageKey = stageOf(column, cards);
                const stage = taskStageBadge(stageKey);
                // A WIP limit is a flag, not a gate — the server never refuses on it.
                const max = column.MaxTasks;
                const full = max != null && max > 0 && cards.length >= max;
                const landing = landingFor(column);
                const addLabel = `Add a task to ${landing?.Title ?? "this board"}`;
                return (
                  <View style={styles.column} testID={`column-${column.Id}`}>
                    <View style={styles.head}>
                      <StatusBadge size={28} tone={stage.tone} icon={stage.icon} testID={`column-stage-${stageKey}`} />
                      <Text variant="rowTitleBold" numberOfLines={1} style={styles.flex}>{column.Title}</Text>
                      <View accessibilityLabel={full ? `${cards.length} of ${max} tasks, at the limit` : undefined} accessible={full}>
                        <Text variant="label" tabular color={full ? "dangerText" : "textSecondary"}>
                          {max ? `${cards.length} / ${max}` : String(cards.length)}
                        </Text>
                      </View>
                      {/* E 07: the head's plus is on the first column only; every column ends in "Add task". */}
                      {wsAbilities.createTask && column.Id === columns[0]?.Id ? (
                        <Pressable onPress={() => addTo(column)} hitSlop={(HIT_TARGET - 18) / 2} accessibilityRole="button" accessibilityLabel={`New task in ${column.Title}`}>
                          <Plus size={18} color={colors.textSecondary} />
                        </Pressable>
                      ) : null}
                    </View>
                    <FlatList
                      data={cards}
                      keyExtractor={(task) => String(task.Id)}
                      showsVerticalScrollIndicator={false}
                      // Pull-to-refresh belongs on the vertical list.
                      refreshControl={<Refresher refreshing={tasksQuery.isRefetching && !loading} onRefresh={tasksQuery.refetch} />}
                      ListEmptyComponent={<Text variant="meta" style={styles.empty}>Nothing here yet.</Text>}
                      renderItem={({ item }) => <TaskCard task={item} onPress={openTask} onLongPress={promptMove} />}
                      ListFooterComponent={
                        wsAbilities.createTask ? (
                          <Pressable
                            onPress={() => addTo(column)}
                            accessibilityRole="button"
                            accessibilityLabel={addLabel}
                            style={({ pressed }) => [styles.add, pressed && styles.sink]}
                          >
                            <Plus size={18} color={colors.primary} />
                            <Text variant="rowTitle" color="primary">Add task</Text>
                          </Pressable>
                        ) : null
                      }
                    />
                  </View>
                );
              }}
            />
          </View>
          {columns.length > 1 ? (
            <View style={styles.dots}>
              <PageDots count={columns.length} index={Math.min(columnIndex, columns.length - 1)} />
            </View>
          ) : null}
        </BandSheet>
      )}

      {menuActions.length ? <ActionSheet ref={menuRef} title={workspace?.Name ?? name} actions={menuActions} /> : null}
      <ActionSheet
        ref={moveRef}
        title={canMove ? "Move to column" : "Cannot move this task"}
        actions={moveActions}
        emptyMessage="You can only move tasks you created or are assigned to."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  column: {
    flex: 1,
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.column,
    // E: the column pads 10 at the top, the same 10 as the gap between columns.
    paddingTop: BOARD_GAP,
    paddingHorizontal: spacing[2],
    paddingBottom: spacing[2],
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingTop: spacing[1],
    paddingHorizontal: spacing[1],
    paddingBottom: BOARD_GAP,
  },
  empty: { paddingHorizontal: spacing[1], paddingBottom: spacing[2] },
  add: {
    height: spacing[10],
    marginTop: spacing[1],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: metrics.inlineGap,
  },
  sink: { transform: [{ scale: 0.97 }] },
  dots: { paddingVertical: BOARD_GAP },
});
