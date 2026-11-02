import { useMemo } from "react";
import { StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRightLeft, CircleCheck, History, ListChecks, MessageCircle, Paperclip, Pencil, Plus, Timer, Trash2, UserPlus,
  type LucideIcon,
} from "lucide-react-native";

import { getTaskActivity } from "../../api/taskQueries";
import { spacing, type BadgeTone } from "../../theme";
import { Card, EmptyState, Text, Timeline, type TimelineEntry } from "../../ui";
import { relativeTime } from "./taskHelpers";

/**
 * tblActivityLog.Action is a free-ish verb written by whichever SP logged the
 * row, so this matches on a substring — an action the backend adds later still
 * lands on a sensible badge instead of vanishing.
 */
const ACTION_BADGE: { match: string; icon: LucideIcon; tone: BadgeTone }[] = [
  { match: "creat", icon: Plus, tone: "slate" },
  { match: "complet", icon: CircleCheck, tone: "green" },
  { match: "checklist", icon: ListChecks, tone: "lilac" },
  { match: "comment", icon: MessageCircle, tone: "teal" },
  { match: "attach", icon: Paperclip, tone: "sky" },
  { match: "file", icon: Paperclip, tone: "sky" },
  { match: "assign", icon: UserPlus, tone: "indigo" },
  { match: "move", icon: ArrowRightLeft, tone: "indigo" },
  { match: "column", icon: ArrowRightLeft, tone: "indigo" },
  { match: "time", icon: Timer, tone: "butter" },
  { match: "delete", icon: Trash2, tone: "red" },
  { match: "remove", icon: Trash2, tone: "red" },
  { match: "statuschang", icon: CircleCheck, tone: "green" },
  { match: "updat", icon: Pencil, tone: "slate" },
];

const badgeFor = (action: string) =>
  ACTION_BADGE.find((e) => action.toLowerCase().includes(e.match)) ?? { icon: History, tone: "slate" as const };

/** A task's audit trail, inside Details (E 08): read-only — it is what happened. */
export default function ActivityTab({ taskId }: { taskId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["task", taskId, "activity"],
    queryFn: () => getTaskActivity({ TaskId: taskId }),
  });

  const entries: TimelineEntry[] = useMemo(
    () =>
      (data ?? []).map((item) => {
        const { icon, tone } = badgeFor(item.Action);
        const change =
          item.OldValue && item.NewValue && item.OldValue !== item.NewValue ? ` · ${item.OldValue} → ${item.NewValue}` : "";
        return {
          key: String(item.Id),
          title: (item.Description ?? item.Action) + change,
          meta: `${item.UserName ?? "System"} · ${relativeTime(item.CreatedDate)}`,
          badge: { tone, icon },
        };
      }),
    [data],
  );

  if (!entries.length) {
    return isLoading ? null : (
      <EmptyState module="tasks" icon={History} title="No history yet" message="Edits, moves and completions on this task get recorded here." />
    );
  }

  return (
    <Card>
      <Timeline entries={entries} />
      {/* The track stops at the last node; this says the log does too. */}
      <Text variant="small" style={styles.end}>Start of history</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  end: { paddingLeft: spacing[10] },
});
