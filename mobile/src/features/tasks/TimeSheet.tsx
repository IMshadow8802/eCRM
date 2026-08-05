import { forwardRef } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Timer, Trash2 } from "lucide-react-native";

import { deleteTaskTimeEntry, getTaskTimeEntries } from "../../api/taskQueries";
import { apiErrorMessage } from "../../api/errors";
import { colors, radius, spacing } from "../../theme";
import { Sheet, Text, useToast, type SheetRef } from "../../ui";
import { formatHours, relativeTime } from "./taskHelpers";

interface TimeSheetProps {
  taskId: number;
  workspaceId: number | null;
  /** The signed-in user. Only their own entries offer a delete. */
  userId: number | null;
  /** Owners and managers may remove anyone's entry. */
  canManageAny: boolean;
  /**
   * True when the server will only return the caller's own rows.
   * `taskController.getTimeEntries` falls back to `req.user.UserId` for
   * anyone who is not an admin, so a member genuinely cannot see the team's
   * hours — the heading has to say so rather than imply a total.
   */
  scopedToMe: boolean;
}

/**
 * The time log for one task: what has been booked, by whom, and a way to undo
 * a mistake. Logging new time is deliberately NOT here — it needs a keyboard,
 * and a form inside the sheet that lists the entries means presenting a second
 * sheet over the first. The task's overflow menu opens the compose sheet.
 */
export const TimeSheet = forwardRef<SheetRef, TimeSheetProps>(function TimeSheet(
  { taskId, workspaceId, userId, canManageAny, scopedToMe },
  ref,
) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data } = useQuery({
    queryKey: ["task", taskId, "time"],
    queryFn: () => getTaskTimeEntries({ TaskId: taskId, PageSize: 50 }),
  });

  const remove = useMutation({
    mutationFn: deleteTaskTimeEntry,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not delete that time entry.")),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const entries = data ?? [];
  const total = entries.reduce((sum, entry) => sum + (entry.Hours ?? 0), 0);

  return (
    <Sheet ref={ref} title={scopedToMe ? "Your time" : "Time logged"}>
      <View style={styles.summary}>
        <Timer size={18} color={colors.primary} />
        <Text variant="bodyStrong">
          {formatHours(total)} across {entries.length} entr
          {entries.length === 1 ? "y" : "ies"}
        </Text>
      </View>

      <ScrollView style={styles.list} bounces={false}>
        {entries.map((entry) => {
          const mine = userId != null && entry.UserId === userId;
          return (
            <View key={entry.Id} style={styles.row}>
              <View style={styles.hours}>
                <Text variant="bodyStrong" color="primary">
                  {formatHours(entry.Hours ?? 0)}
                </Text>
              </View>

              <View style={styles.text}>
                <Text variant="body" numberOfLines={2}>
                  {entry.Description || "No note"}
                </Text>
                <Text variant="caption" color="textMuted">
                  {entry.UserName ?? "Someone"} ·{" "}
                  {relativeTime(entry.WorkDate ?? entry.CreatedDate)}
                </Text>
              </View>

              {mine || canManageAny ? (
                <Pressable
                  hitSlop={spacing[2]}
                  disabled={remove.isPending}
                  onPress={() =>
                    remove.mutate({
                      Id: entry.Id,
                      TaskId: taskId,
                      WorkspaceId: workspaceId,
                    })
                  }
                  accessibilityLabel="Delete this time entry"
                  accessibilityRole="button"
                >
                  <Trash2 size={18} color={colors.danger} />
                </Pressable>
              ) : null}
            </View>
          );
        })}

        {!entries.length ? (
          <Text variant="secondary" style={styles.empty}>
            {scopedToMe
              ? "You have not booked any time against this task."
              : "No time booked against this task yet."}
          </Text>
        ) : null}
      </ScrollView>
    </Sheet>
  );
});

export default TimeSheet;

const styles = StyleSheet.create({
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
  },
  list: { maxHeight: 360 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  hours: {
    minWidth: 56,
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
  },
  text: { flex: 1, gap: spacing[1] },
  empty: { padding: spacing[4] },
});
