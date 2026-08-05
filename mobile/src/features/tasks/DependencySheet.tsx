import { forwardRef } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CircleCheck, X } from "lucide-react-native";

import {
  fetchTaskDependencies,
  removeTaskDependency,
} from "../../api/taskQueries";
import { apiErrorMessage } from "../../api/errors";
import type { TaskDependency } from "../../types/api";
import { colors, radius, spacing } from "../../theme";
import { Sheet, Text, useToast, type SheetRef } from "../../ui";

interface DependencySheetProps {
  taskId: number;
  workspaceId: number | null;
  /** Dependencies redefine the work, so removing one needs edit_fields. */
  canEdit: boolean;
}

/**
 * What this task is waiting on, and what is waiting on it.
 *
 * Dependencies are HARD blocks in this system — an incomplete blocker is the
 * reason a task cannot be finished — so each row leads with whether it is done
 * rather than with its title. Only blockers can be removed here: a dependent
 * edge belongs to the other task, and unlinking it from this side would be a
 * change that task's owner never sees.
 */
export const DependencySheet = forwardRef<SheetRef, DependencySheetProps>(
  function DependencySheet({ taskId, workspaceId, canEdit }, ref) {
    const queryClient = useQueryClient();
    const toast = useToast();

    const { data } = useQuery({
      queryKey: ["task", taskId, "dependencies"],
      queryFn: () => fetchTaskDependencies({ TaskId: taskId }),
    });

    const remove = useMutation({
      mutationFn: removeTaskDependency,
      onError: (err) => toast.error(apiErrorMessage(err, "Could not remove that blocker.")),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["task", taskId] });
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
      },
    });

    const blockers = data?.blockers ?? [];
    const dependents = data?.dependents ?? [];
    const open = blockers.filter((d) => !d.IsCompleted).length;

    const row = (dep: TaskDependency, removable: boolean) => (
      <View key={`${dep.Direction}-${dep.TaskId}`} style={styles.row}>
        {dep.IsCompleted ? (
          <CircleCheck size={20} color={colors.success} />
        ) : (
          <Ban size={20} color={colors.danger} />
        )}

        <View style={styles.text}>
          <Text variant="body" numberOfLines={2}>
            {dep.Title ?? `Task #${dep.TaskId}`}
          </Text>
          <Text variant="caption" color="textMuted">
            {dep.IsCompleted ? "Done" : "Still open"}
            {dep.ColumnTitle ? ` · ${dep.ColumnTitle}` : ""}
          </Text>
        </View>

        {removable ? (
          <Pressable
            hitSlop={spacing[2]}
            disabled={remove.isPending}
            onPress={() =>
              remove.mutate({
                TaskId: taskId,
                DependsOnTaskId: dep.TaskId,
                WorkspaceId: workspaceId,
              })
            }
            accessibilityLabel="Remove this dependency"
            accessibilityRole="button"
          >
            {/* A cross, not a bin: this unlinks the two tasks, it does not
                delete the blocking task. */}
            <X size={20} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
    );

    return (
      <Sheet ref={ref} title="Dependencies">
        <View style={styles.summary}>
          <Ban size={18} color={open ? colors.danger : colors.success} />
          <Text variant="bodyStrong">
            {open
              ? `${open} unfinished blocker${open === 1 ? "" : "s"}`
              : "Nothing is blocking this task"}
          </Text>
        </View>

        <ScrollView style={styles.list} bounces={false}>
          {blockers.length ? (
            <>
              <Text variant="overline" color="textMuted" style={styles.heading}>
                Blocked by
              </Text>
              {blockers.map((dep) => row(dep, canEdit))}
            </>
          ) : null}

          {dependents.length ? (
            <>
              <Text variant="overline" color="textMuted" style={styles.heading}>
                Waiting on this
              </Text>
              {dependents.map((dep) => row(dep, false))}
            </>
          ) : null}

          {!blockers.length && !dependents.length ? (
            <Text variant="secondary" style={styles.empty}>
              This task has no dependencies.
            </Text>
          ) : null}
        </ScrollView>
      </Sheet>
    );
  },
);

export default DependencySheet;

const styles = StyleSheet.create({
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
  },
  list: { maxHeight: 360 },
  heading: { paddingHorizontal: spacing[4], paddingTop: spacing[2] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: radius.md,
  },
  text: { flex: 1, gap: spacing[1] },
  empty: { padding: spacing[4] },
});
