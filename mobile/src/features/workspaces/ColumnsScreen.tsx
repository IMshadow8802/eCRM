import { useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Columns3, Pencil, Plus, Trash2 } from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import {
  deleteKanbanColumn,
  fetchKanbanColumns,
  saveKanbanColumn,
} from "../../api/kanbanQueries";
import { apiErrorMessage } from "../../api/errors";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import { boardQuery } from "../tasks/taskHelpers";
import type { KanbanColumn } from "../../types/api";
import { colors, spacing } from "../../theme";
import {
  ActionSheet,
  Band,
  BandSheet,
  ComposeSheet,
  Dialog,
  EmptyState,
  HeaderButton,
  ListGroup,
  ListRow,
  Screen,
  SkeletonRows,
  useToast,
  type SheetAction,
  type SheetRef,
} from "../../ui";

type Props = StackScreenProps<RootStackParamList, "Columns">;

const MAX_TASK_LIMIT = 1000;

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

  const { data: taskData } = useQuery(boardQuery(workspaceId));

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
    // Like the title, a blank limit keeps what the column had; 0 clears it.
    const limit = (values.limit ?? "").trim();
    if (limit && !/^\d+$/.test(limit)) {
      setComposeError("The limit is a whole number of tasks, or 0 for none.");
      return;
    }
    // MaxTasks is an INT; a pasted run of digits would overflow it server-side.
    if (Number(limit) > MAX_TASK_LIMIT) {
      setComposeError(`A limit can be at most ${MAX_TASK_LIMIT} tasks.`);
      return;
    }
    const maxTasks = limit ? Number(limit) || null : (editing?.MaxTasks ?? null);
    // sp_SaveKanbanColumn is a full upsert, so every field has to go back up —
    // omitting Color on a rename would quietly blank it.
    save.mutate({
      Id: editing?.Id ?? 0,
      WorkspaceId: workspaceId,
      Title: title,
      Color: editing?.Color ?? null,
      // 0 tells sp_SaveKanbanColumn to append at MAX+1; columns.length tied
      // the last column, whose seeded order is already n.
      SortOrder: editing?.SortOrder ?? 0,
      MaxTasks: maxTasks,
      // The server 400s IsActive: false — a column is deleted, never parked.
      IsActive: true,
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
    <Screen band>
      <Band
        title="Columns"
        count={`${columns.length} column${columns.length === 1 ? "" : "s"}`}
        variant="record"
        onBack={navigation.goBack}
        actions={<HeaderButton label="New" icon={Plus} accessibilityLabel="Add a column" onPress={() => openCompose(null)} />}
      />

      <BandSheet scroll center={!isLoading && !columns.length}>
        {isLoading ? (
          <SkeletonRows rows={3} />
        ) : !columns.length ? (
          <EmptyState
            module="tasks"
            icon={Columns3}
            title="No columns yet"
            message="A board needs at least one column before it can hold tasks."
            actionLabel="Add a column"
            onAction={() => openCompose(null)}
          />
        ) : (
          <ListGroup>
            {columns.map((item, i) => (
              <ListRow
                key={item.Id}
                noSeparator={i === 0}
                badge={{ tone: "slate", icon: Columns3, size: 36 }}
                title={item.Title}
                meta={`${countIn(item.Id)} task${countIn(item.Id) === 1 ? "" : "s"}`}
                trailing={
                  <View style={styles.tools}>
                    <Pressable
                      hitSlop={spacing[3]}
                      onPress={() => openCompose(item)}
                      accessibilityLabel={`Rename ${item.Title}`}
                      accessibilityRole="button"
                    >
                      <Pencil size={18} color={colors.textSecondary} />
                    </Pressable>
                    {/* The last column stays — a board with none cannot hold a task. */}
                    {columns.length > 1 ? (
                      <Pressable
                        hitSlop={spacing[3]}
                        onPress={() => startDelete(item)}
                        accessibilityLabel={`Delete ${item.Title}`}
                        accessibilityRole="button"
                      >
                        <Trash2 size={18} color={colors.danger} />
                      </Pressable>
                    ) : null}
                  </View>
                }
              />
            ))}
          </ListGroup>
        )}
      </BandSheet>

      <ComposeSheet
        ref={composeRef}
        title={editing ? "Edit column" : "New column"}
        submitLabel={editing ? "Save" : "Add column"}
        fields={[
          {
            key: "title",
            placeholder: editing?.Title ?? "To do",
            required: true,
          },
          {
            key: "limit",
            placeholder: editing?.MaxTasks
              ? `Task limit: ${editing.MaxTasks} (0 = none)`
              : "Task limit (blank = none)",
            numeric: true,
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
        badge={{ tone: "red", icon: Trash2 }}
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
  tools: { flexDirection: "row", alignItems: "center", gap: spacing[4] },
});
