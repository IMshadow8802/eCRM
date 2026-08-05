import { useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Columns3, Pencil, Plus, Trash2 } from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import {
  deleteKanbanColumn,
  fetchKanbanColumns,
  saveKanbanColumn,
} from "../../api/kanbanQueries";
import { apiErrorMessage } from "../../api/errors";
import { fetchTasks } from "../../api/taskQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import type { KanbanColumn } from "../../types/api";
import { colors, radius, shadows, spacing, SCREEN_PADDING } from "../../theme";
import {
  ActionSheet,
  ComposeSheet,
  Dialog,
  EmptyState,
  Fab,
  Screen,
  ScreenHeader,
  Text,
  type SheetAction,
  type SheetRef,
  useToast,
} from "../../ui";

type Props = StackScreenProps<RootStackParamList, "Columns">;

/**
 * Add, rename and delete a board's columns.
 *
 * Reordering is not here. `SortOrder` is a per-row write, so dragging a list
 * of columns means N updates and a conflict story for two people reordering at
 * once — a desk job. The phone can create and rename, which is what someone
 * standing at a board actually needs.
 */
export default function ColumnsScreen({ route, navigation }: Props) {
  const { workspaceId } = route.params;
  const queryClient = useQueryClient();
  const toast = useToast();

  const [editing, setEditing] = useState<KanbanColumn | null>(null);
  const [deleting, setDeleting] = useState<KanbanColumn | null>(null);
  const [reassignTo, setReassignTo] = useState<number | null>(null);

  const composeRef = useRef<SheetRef>(null);
  const reassignRef = useRef<SheetRef>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["columns", workspaceId],
    queryFn: () => fetchKanbanColumns({ WorkspaceId: workspaceId }),
  });

  const { data: taskData } = useQuery({
    queryKey: ["tasks", "board", workspaceId],
    queryFn: () => fetchTasks({ WorkspaceId: workspaceId, PageSize: 200 }),
  });

  const columns = data ?? [];
  const tasks = taskData?.data?.tasks ?? [];
  const countIn = (columnId: number) =>
    tasks.filter((t) => t.ColumnId === columnId).length;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["columns", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  const [composeError, setComposeError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: saveKanbanColumn,
    onError: (err) =>
      setComposeError(apiErrorMessage(err, "Could not save that column.")),
    onSuccess: () => {
      composeRef.current?.dismiss();
      setEditing(null);
      refresh();
    },
  });

  const remove = useMutation({
    mutationFn: deleteKanbanColumn,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not delete that column.")),
    onSuccess: () => {
      setDeleting(null);
      setReassignTo(null);
      refresh();
    },
  });

  const openCompose = (column: KanbanColumn | null) => {
    setEditing(column);
    setComposeError(null);
    composeRef.current?.present();
  };

  const submit = (values: Record<string, string>) => {
    const title = (values.title ?? "").trim();
    if (!title) return;
    // sp_SaveKanbanColumn is a full upsert, so every field has to go back up —
    // omitting Color on a rename would quietly blank it.
    save.mutate({
      Id: editing?.Id ?? 0,
      WorkspaceId: workspaceId,
      Title: title,
      Color: editing?.Color ?? null,
      SortOrder: editing?.SortOrder ?? columns.length,
      MaxTasks: editing?.MaxTasks ?? null,
      IsActive: editing?.IsActive ?? true,
    });
  };

  // Deleting a column with cards in it has to say where they go, or they are
  // orphaned into "Unsorted" on the board with no way back. The confirmation
  // waits until that choice is made, so the sheet and the dialog never fight
  // over the screen.
  const startDelete = (column: KanbanColumn) => {
    setReassignTo(null);
    setDeleting(column);
    if (countIn(column.Id) > 0) reassignRef.current?.present();
  };

  const reassignActions: SheetAction[] = columns
    .filter((c) => c.Id !== deleting?.Id)
    .map((column) => ({
      key: String(column.Id),
      label: column.Title,
      icon: Columns3,
      selected: reassignTo === column.Id,
      onPress: () => setReassignTo(column.Id),
    }));

  const pendingCount = deleting ? countIn(deleting.Id) : 0;
  const reassignName = columns.find((c) => c.Id === reassignTo)?.Title;

  return (
    <Screen>
      <ScreenHeader
        title="Columns"
        subtitle={`${columns.length} column${columns.length === 1 ? "" : "s"}`}
        onBack={navigation.goBack}
      />

      <FlatList
        data={columns}
        keyExtractor={(column) => String(column.Id)}
        contentContainerStyle={[
          styles.list,
          !columns.length && styles.listEmpty,
        ]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          isLoading ? null : (
            <EmptyState
              icon={Columns3}
              title="No columns yet"
              message="A board needs at least one column before it can hold tasks."
              actionLabel="Add a column"
              onAction={() => openCompose(null)}
            />
          )
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View
              style={[
                styles.dot,
                { backgroundColor: item.Color ?? colors.primary },
              ]}
            />

            <View style={styles.text}>
              <Text variant="h3" numberOfLines={1}>
                {item.Title}
              </Text>
              <Text variant="caption" color="textMuted">
                {countIn(item.Id)} task{countIn(item.Id) === 1 ? "" : "s"}
              </Text>
            </View>

            <Pressable
              hitSlop={spacing[2]}
              onPress={() => openCompose(item)}
              accessibilityLabel={`Rename ${item.Title}`}
              accessibilityRole="button"
            >
              <Pencil size={19} color={colors.textSecondary} />
            </Pressable>

            <Pressable
              hitSlop={spacing[2]}
              onPress={() => startDelete(item)}
              accessibilityLabel={`Delete ${item.Title}`}
              accessibilityRole="button"
            >
              <Trash2 size={19} color={colors.danger} />
            </Pressable>
          </View>
        )}
      />

      <Fab
        icon={Plus}
        accessibilityLabel="Add a column"
        onPress={() => openCompose(null)}
      />

      <ComposeSheet
        ref={composeRef}
        title={editing ? "Rename column" : "New column"}
        submitLabel={editing ? "Save" : "Add column"}
        fields={[
          {
            key: "title",
            placeholder: editing?.Title ?? "To do",
            required: true,
          },
        ]}
        busy={save.isPending}
        error={composeError}
        onSubmit={submit}
      />

      <ActionSheet
        ref={reassignRef}
        title="Move its tasks where?"
        actions={reassignActions}
        emptyMessage="There is no other column to move them to. Add one first."
      />

      <Dialog
        visible={Boolean(deleting) && (pendingCount === 0 || reassignTo != null)}
        title={`Delete "${deleting?.Title ?? ""}"?`}
        message={
          pendingCount === 0
            ? "The column is empty, so nothing else changes."
            : `Its ${pendingCount} task${pendingCount === 1 ? "" : "s"} will move to ${reassignName}.`
        }
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate({
            Id: deleting.Id,
            ReassignToColumnId: reassignTo,
            WorkspaceId: workspaceId,
          })
        }
        onCancel={() => {
          setDeleting(null);
          setReassignTo(null);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: SCREEN_PADDING,
    paddingBottom: spacing[20],
    gap: spacing[3],
  },
  listEmpty: { flexGrow: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing[4],
    ...shadows.md,
  },
  dot: { width: 12, height: 12, borderRadius: radius.full },
  text: { flex: 1, gap: spacing[1] },
});
