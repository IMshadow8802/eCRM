import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  Archive,
  ChevronRight,
  Eye,
  FolderKanban,
  Pencil,
  Shield,
  Star,
  User,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react-native";

import type { Workspace, WorkspaceRole, WorkspaceType } from "../../types/api";
import { colors, radius, shadows, spacing } from "../../theme";
import { Text } from "../../ui";

/**
 * Each workspace type gets its own glyph and colour so the list scans fast.
 *
 * The rounded family (UserRound / UsersRound) rather than the squared one: it
 * matches the app's rounded language, and one person vs several is a shape
 * difference you can read at 19px, which a padlock-vs-rocket pairing was not —
 * those said "locked" and "launch", neither of which is what the type means.
 */
const TYPE_META: Record<
  WorkspaceType,
  { Icon: LucideIcon; color: keyof typeof colors; label: string }
> = {
  personal: { Icon: UserRound, color: "neutralIcon", label: "Personal" },
  shared: { Icon: UsersRound, color: "primary", label: "Shared" },
  project: { Icon: FolderKanban, color: "info", label: "Project" },
};

/** Role decides what you can do, so it is worth showing on the card. */
const ROLE_META: Record<
  WorkspaceRole,
  { Icon: LucideIcon; tone: keyof typeof colors }
> = {
  owner: { Icon: Star, tone: "priorityMedium" },
  manager: { Icon: Shield, tone: "primary" },
  member: { Icon: Pencil, tone: "textSecondary" },
  viewer: { Icon: Eye, tone: "textMuted" },
};

interface WorkspaceCardProps {
  workspace: Workspace;
  onPress: (workspace: Workspace) => void;
}

function WorkspaceCardBase({ workspace, onPress }: WorkspaceCardProps) {
  const type = TYPE_META[workspace.Type] ?? TYPE_META.shared;
  const role = workspace.MyRole ? ROLE_META[workspace.MyRole] : null;
  const members = workspace.MemberCount ?? 0;

  return (
    <Pressable
      onPress={() => onPress(workspace)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={[styles.glyph, { backgroundColor: colors[type.color] }]}>
        <type.Icon size={19} color={colors.textOnBrand} />
      </View>

      <View style={styles.main}>
        <View style={styles.titleRow}>
          <Text variant="h3" numberOfLines={1} style={styles.title}>
            {workspace.Name}
          </Text>
          {workspace.IsArchived ? (
            <Archive
              size={16}
              color={colors.textMuted}
            />
          ) : null}
        </View>

        <View style={styles.stats}>
          {/* No icon here — the glyph on the left is already this same one,
              and repeating it inside the row it labels reads as clutter. The
              colour carries the link. */}
          <View style={styles.stat}>
            <Text variant="caption" color={type.color}>
              {type.label}
            </Text>
          </View>

          {/* Personal workspaces are owner-only — a member count there is noise. */}
          {workspace.Type !== "personal" ? (
            <View style={styles.stat}>
              <User size={13} color={colors.textMuted} />
              <Text variant="caption" color="textMuted">
                {members} member{members === 1 ? "" : "s"}
              </Text>
            </View>
          ) : null}

          {role && workspace.MyRole ? (
            <View style={styles.stat}>
              <role.Icon size={13} color={colors[role.tone]} />
              <Text variant="caption" color={role.tone}>
                {workspace.MyRole}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <ChevronRight size={22} color={colors.textMuted} />
    </Pressable>
  );
}

export const WorkspaceCard = memo(WorkspaceCardBase);
export default WorkspaceCard;

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing[4],
    // See TaskCard: the border separates, the shadow only lifts.
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.md,
  },
  pressed: { transform: [{ scale: 0.985 }] },
  // 38, not 46. The glyph is a label for the row, not its subject — at 46 it
  // was the heaviest thing on the card and pulled the eye off the board's name.
  glyph: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  main: { flex: 1, gap: spacing[1] },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  title: { flexShrink: 1 },
  stats: { flexDirection: "row", alignItems: "center", gap: spacing[3], flexWrap: "wrap" },
  stat: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
});
