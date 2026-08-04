import { useMemo } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  CircleCheck,
  History,
  ListChecks,
  MessageCircle,
  Paperclip,
  Pencil,
  Plus,
  Timer,
  Trash2,
  UserPlus,
  type LucideIcon,
} from "lucide-react-native";

import { getTaskActivity } from "../../api/taskQueries";
import { colors, spacing, SCREEN_PADDING } from "../../theme";
import { EmptyState, Text, Timeline, type TimelineEntry } from "../../ui";
import { relativeTime } from "./taskHelpers";

/**
 * tblActivityLog.Action is a free-ish verb written by whichever SP logged the
 * row, so this matches on a substring rather than an exact set — an action the
 * backend adds later still lands on a sensible node instead of vanishing.
 */
const ACTION_NODE: { match: string; Icon: LucideIcon; tone: keyof typeof colors }[] = [
  { match: "creat", Icon: Plus, tone: "success" },
  { match: "complet", Icon: CircleCheck, tone: "success" },
  { match: "checklist", Icon: ListChecks, tone: "primary" },
  { match: "comment", Icon: MessageCircle, tone: "info" },
  { match: "attach", Icon: Paperclip, tone: "info" },
  { match: "file", Icon: Paperclip, tone: "info" },
  { match: "assign", Icon: UserPlus, tone: "primary" },
  { match: "move", Icon: ArrowRightLeft, tone: "primary" },
  { match: "column", Icon: ArrowRightLeft, tone: "primary" },
  { match: "time", Icon: Timer, tone: "warning" },
  { match: "delete", Icon: Trash2, tone: "danger" },
  { match: "remove", Icon: Trash2, tone: "danger" },
  { match: "updat", Icon: Pencil, tone: "textSecondary" },
];

function nodeFor(action: string) {
  return (
    ACTION_NODE.find((entry) => action.toLowerCase().includes(entry.match)) ?? {
      Icon: History,
      tone: "textSecondary" as keyof typeof colors,
    }
  );
}

interface ActivityTabProps {
  taskId: number;
}

/** Read-only audit trail. Nothing here is editable — it is what happened. */
export default function ActivityTab({ taskId }: ActivityTabProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["task", taskId, "activity"],
    queryFn: () => getTaskActivity({ TaskId: taskId }),
  });

  const entries: TimelineEntry[] = useMemo(
    () =>
      (data ?? []).map((item) => {
        const node = nodeFor(item.Action);
        return {
          key: String(item.Id),
          title: item.Description ?? item.Action,
          meta: `${item.UserName ?? "System"} · ${relativeTime(item.CreatedDate)}`,
          icon: node.Icon,
          tone: node.tone,
        };
      }),
    [data],
  );

  if (!entries.length) {
    return isLoading ? null : (
      <EmptyState
        icon={History}
        title="No history yet"
        message="Edits, moves and completions on this task get recorded here."
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
    >
      <Timeline entries={entries} />
      {/* The rail stops at the last node; this says the log does too, rather
          than leaving it looking truncated. */}
      <Text variant="caption" color="textMuted" style={styles.end}>
        Start of history
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: spacing[2],
    paddingBottom: spacing[20],
  },
  // Lines up under the entry text, not under the rail.
  end: { paddingLeft: spacing[10] },
});
