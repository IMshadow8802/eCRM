import { FlatList, StyleSheet, View } from "react-native";
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
import { colors, radius, shadows, spacing, SCREEN_PADDING } from "../../theme";
import { EmptyState, Text } from "../../ui";
import { relativeTime } from "./taskHelpers";

/**
 * tblTaskActivity.Action is a free-ish verb written by whichever SP logged the
 * row, so this matches on a substring rather than an exact set — an action the
 * backend adds later still lands on a sensible glyph instead of vanishing.
 */
const ACTION_ICON: { match: string; Icon: LucideIcon; tone: keyof typeof colors }[] = [
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

function glyphFor(action: string) {
  const key = action.toLowerCase();
  return (
    ACTION_ICON.find((entry) => key.includes(entry.match)) ?? {
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

  const entries = data ?? [];

  return (
    <FlatList
      data={entries}
      keyExtractor={(entry) => String(entry.Id)}
      contentContainerStyle={[styles.list, !entries.length && styles.listEmpty]}
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={
        isLoading ? null : (
          <EmptyState
            icon={History}
            title="No history yet"
            message="Edits, moves and completions on this task get recorded here."
          />
        )
      }
      renderItem={({ item }) => {
        const { Icon, tone } = glyphFor(item.Action);
        return (
          <View style={styles.row}>
            <View style={[styles.glyph, { backgroundColor: colors[tone] }]}>
              <Icon size={16} color={colors.textOnBrand} />
            </View>
            <View style={styles.text}>
              <Text variant="body">{item.Description ?? item.Action}</Text>
              <Text variant="caption" color="textMuted">
                {item.UserName ?? "System"} · {relativeTime(item.CreatedDate)}
              </Text>
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: SCREEN_PADDING,
    paddingBottom: spacing[20],
    gap: spacing[3],
  },
  listEmpty: { flexGrow: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing[3],
    ...shadows.sm,
  },
  glyph: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1, gap: spacing[1] },
});
