import { memo } from "react";
import {
  Ban,
  Bug,
  Check,
  CircleCheckBig,
  CircleAlert,
  Clock,
  Columns3,
  Flag,
  FolderOpen,
  GitBranch,
  Globe,
  Layers,
  ListChecks,
  Sparkles,
  Timer,
  TrendingUp,
  type LucideIcon,
} from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import type { Task, TaskPriority } from "../../types/api";
import { colors, radius, shadows, spacing } from "../../theme";
import { Avatar, Text } from "../../ui";
import {
  assigneesOf,
  checklistProgress,
  dueBucket,
  dueLabel,
  formatHours,
} from "./taskHelpers";

interface TaskCardProps {
  task: Task;
  onPress: (task: Task) => void;
  /** Board view uses this for "move to…" — there is no drag on a phone. */
  onLongPress?: (task: Task) => void;
  /** Hide the workspace name when the list is already scoped to one board. */
  showWorkspace?: boolean;
}

/** Icon comes from the task's type, colour from its priority. */
const TYPE_ICON: Record<string, LucideIcon> = {
  task: Layers,
  bug: Bug,
  feature: Sparkles,
  improvement: TrendingUp,
  research: Globe,
};

const PRIORITY_INK: Record<TaskPriority, keyof typeof colors> = {
  low: "priorityLow",
  medium: "priorityMedium",
  high: "priorityHigh",
  urgent: "priorityUrgent",
};

/**
 * One icon + value pair. Reads faster than a labelled row and packs tighter.
 *
 * Outlined, never filled. lucide has no filled variants, and faking them with
 * the SVG `fill` prop turns an icon into a blob wherever its meaning lives in
 * its interior lines. Weight comes from the stroke instead — see the
 * LucideProvider in App.tsx.
 */
function Stat({
  Icon,
  value,
  tone = "textSecondary",
}: {
  Icon: LucideIcon;
  value: string;
  tone?: keyof typeof colors;
}) {
  return (
    <View style={styles.stat}>
      <Icon size={14} color={colors[tone]} />
      <Text variant="caption" color={tone}>
        {value}
      </Text>
    </View>
  );
}

function TaskCardBase({
  task,
  onPress,
  onLongPress,
  showWorkspace = true,
}: TaskCardProps) {
  const { done, total } = checklistProgress(task);
  const pct = total > 0 ? done / total : 0;
  const overdue = dueBucket(task.DueDate) === "overdue";
  const due = dueLabel(task.DueDate);
  const assignees = assigneesOf(task);

  const priority = task.Priority ?? null;
  const ink = task.IsCompleted
    ? colors.success
    : priority
      ? colors[PRIORITY_INK[priority]]
      : colors.neutralIcon;

  const Icon = task.IsCompleted
    ? Check
    : (TYPE_ICON[task.Type ?? "task"] ?? TYPE_ICON.task!);

  /**
   * The footer strip takes the card's ink at FULL strength, with white on it.
   *
   * Not a 50-level tint of it: a pale wash is exactly the washed-out look this
   * app has a standing rule against, and it reads as a mistake rather than as
   * a choice. A strip is either a colour or it is not.
   *
   * `ink` already resolves done-outranks-priority — a finished urgent task is
   * not urgent any more — so the strip just takes it.
   */
  const strip = ink;

  const logged = task.LoggedHours ?? 0;
  const estimated = task.EstimatedHours ?? 0;
  const subTasks = task.SubTaskCount ?? 0;
  const blockers = task.BlockerCount ?? 0;

  return (
    <Pressable
      onPress={() => onPress(task)}
      onLongPress={onLongPress ? () => onLongPress(task) : undefined}
      delayLongPress={300}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.body}>
        <View style={styles.row}>
          <View style={styles.main}>
            <View style={styles.titleRow}>
              <Icon size={15} color={ink} style={styles.titleIcon} />
              <Text
                variant="h3"
                numberOfLines={2}
                style={[styles.title, task.IsCompleted && styles.doneText]}
              >
                {task.Title}
              </Text>
            </View>
          </View>

          <View style={styles.assignees}>
            {assignees.slice(0, 2).map((a, i) => (
              <View
                key={a.UserId}
                style={[styles.avatarSlot, i > 0 && styles.avatarOverlap]}
              >
                <Avatar name={a.FullName} uri={a.Avatar} size={26} />
              </View>
            ))}
            {assignees.length > 2 ? (
              <View style={[styles.avatarSlot, styles.avatarOverlap, styles.more]}>
                <Text variant="caption" color="textSecondary">
                  +{assignees.length - 2}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Shown when finished too, filled and green. "3 of 3" is the proof the
            work was actually done — hiding the bar at 100% removes the only
            thing that distinguishes a task that had nine steps from one that
            had none. */}
        {total > 0 ? (
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                {
                  width: `${task.IsCompleted ? 100 : Math.round(pct * 100)}%`,
                  backgroundColor: ink,
                },
              ]}
            />
          </View>
        ) : null}

        {/* Everything here comes from columns sp_FetchTask already returns —
            none of it costs an extra request. */}
        <View style={styles.stats}>
          {total > 0 ? (
            <Stat
              Icon={task.IsCompleted ? CircleCheckBig : ListChecks}
              value={`${done} of ${total}`}
              tone={task.IsCompleted ? "success" : "textSecondary"}
            />
          ) : null}
          {logged > 0 ? (
            <Stat
              Icon={Timer}
              value={
                estimated > 0
                  ? `${formatHours(logged)} / ${formatHours(estimated)}`
                  : formatHours(logged)
              }
              tone={estimated > 0 && logged > estimated ? "danger" : "textSecondary"}
            />
          ) : null}
          {subTasks > 0 ? (
            <Stat Icon={GitBranch} value={String(subTasks)} />
          ) : null}
          {blockers > 0 ? (
            <Stat Icon={Ban} value={String(blockers)} tone="danger" />
          ) : null}
          {priority ? (
            <Stat Icon={Flag} value={priority} tone={PRIORITY_INK[priority]} />
          ) : null}

          <View style={styles.spacer} />

          {due ? (
            <Stat
              Icon={overdue ? CircleAlert : Clock}
              value={due}
              tone={overdue ? "danger" : "textSecondary"}
            />
          ) : null}
        </View>
      </View>

      {/* The board, given its own tinted strip across the foot of the card.
          It was a 11px grey line lost among five other 11px grey lines, and on
          My Work — which spans every workspace you are in — which board a task
          belongs to is the first thing you need, not the last. */}
      {showWorkspace && task.WorkspaceName ? (
        <View style={[styles.footer, { backgroundColor: strip }]}>
          <FolderOpen size={14} color={colors.textOnBrand} />
          <Text
            variant="label"
            color="textOnBrand"
            numberOfLines={1}
            style={styles.board}
          >
            {task.WorkspaceName}
          </Text>
          {task.ColumnTitle ? (
            <>
              <Columns3 size={13} color={colors.textOnBrand} />
              <Text variant="caption" color="textOnBrand" numberOfLines={1}>
                {task.ColumnTitle}
              </Text>
            </>
          ) : null}
        </View>
      ) : task.ColumnTitle ? (
        // On a board the workspace is a given, so the strip carries the column
        // alone rather than disappearing and leaving a plain slab.
        <View style={[styles.footer, { backgroundColor: strip }]}>
          <Columns3 size={14} color={colors.textOnBrand} />
          <Text
            variant="label"
            color="textOnBrand"
            numberOfLines={1}
            style={styles.board}
          >
            {task.ColumnTitle}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Lists re-render on every refetch; the card only changes when the task does. */
export const TaskCard = memo(TaskCardBase);
export default TaskCard;

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    /**
     * No padding here — the footer strip runs edge to edge, so each section
     * pads itself.
     *
     * And NO `overflow: hidden`, even though that is the obvious way to make
     * the strip respect the bottom corners. On iOS it sets `masksToBounds` on
     * the layer, which clips the layer's own shadow as well as its children —
     * the card goes completely flat and merges into a white page. That is why
     * these looked dead next to the Work hub's cards, which are the same
     * `shadows.md` without the clip. The footer rounds its own corners instead.
     */
    ...shadows.md,
  },
  // Presses INTO the page: it sinks by the shadow offset and the shadow
  // shrinks with it, which is what a lifted object does when you push it.
  // No dimming — solid surfaces stay solid.
  pressed: {
    transform: [{ scale: 0.985 }, { translateY: 2 }],
    ...shadows.sm,
  },
  body: { padding: spacing[4], gap: spacing[3] },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  main: { flex: 1, gap: spacing[1] },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  // Fixed, so a two-line title wraps under itself rather than under the icon.
  titleIcon: { marginTop: 1 },
  title: { flex: 1 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    // Rounds itself to match the card, so the card never needs to clip — see
    // the note on `card` for why clipping is not an option here.
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    // No rule above it: the colour change from white to a solid strip already
    // is the edge, and a grey hairline across it just looks like a seam.
  },
  // Shrinks before the column label does — a long board name should truncate,
  // not push the column off the card.
  board: { flexShrink: 1 },
  // Muted strike, muted line. The strikethrough is what actually reads as
  // "finished" at a glance, so it stays — but deliberately uncoloured: React
  // Native has no textDecorationThickness, and at 16px a 1px line is too thin
  // to carry a colour. Muted works because it matches the text either way,
  // including on Android where the line always inherits the text colour.
  doneText: {
    textDecorationLine: "line-through",
    color: colors.textMuted,
  },
  assignees: { flexDirection: "row", alignItems: "center" },
  avatarSlot: {
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  avatarOverlap: { marginLeft: -spacing[3] },
  more: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSunken,
    alignItems: "center",
    justifyContent: "center",
  },
  track: {
    height: 3,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSunken,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: radius.full },
  stats: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    flexWrap: "wrap",
  },
  stat: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  spacer: { flex: 1 },
});
