import { memo } from "react";
import { StyleSheet, View } from "react-native";
import {
  Archive,
  ChevronRight,
  Eye,
  FolderKanban,
  LockKeyhole,
  Pencil,
  Shield,
  Star,
  User,
  UsersRound,
  type LucideIcon,
} from "lucide-react-native";

import type { Workspace, WorkspaceRole, WorkspaceType } from "../../types/api";
import { colors, spacing } from "../../theme";
import {
  Card,
  Glyph,
  Text,
} from "../../ui";

/**
 * Each workspace type gets its own glyph and colour so the list scans fast.
 *
 * The three glyphs answer ONE question — who can see this board — because that
 * is the only thing the type decides:
 *
 *   personal  nobody but you, private even from an admin  ->  a lock
 *   shared    the people you invite, once they accept     ->  several people
 *   project   whoever is on the linked project's team     ->  a project folder
 *
 * `UserRound` for personal was the weak one and is gone. A single person is who
 * a board belongs to, not who can open it — every board has an owner, so the
 * glyph was true of all three and told you nothing. Worse, it sat 19px from the
 * member-count icon in the row below, which is also a person and means something
 * else entirely.
 *
 * This reverses an earlier call that ruled a padlock out as "locked, which is
 * not what the type means". Locked is exactly what it means: a personal
 * workspace is invisible to everyone else including admins, and that rule has no
 * exception. What was actually wrong back then was pairing it with a rocket for
 * project — "launch" is not a visibility rule.
 */
const TYPE_META: Record<
  WorkspaceType,
  { Icon: LucideIcon; color: keyof typeof colors; label: string }
> = {
  personal: { Icon: LockKeyhole, color: "neutralIcon", label: "Personal" },
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
    <Card onPress={() => onPress(workspace)} style={styles.row}>
      <Glyph icon={type.Icon} tint={colors[type.color]} size="md" />

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
    </Card>
  );
}

export const WorkspaceCard = memo(WorkspaceCardBase);
export default WorkspaceCard;

const styles = StyleSheet.create({
  // This card lays its children out sideways rather than stacked, which is the
  // one thing Card does not decide for it.
  row: { flexDirection: "row", alignItems: "center" },
  // 38, not 46. The glyph is a label for the row, not its subject — at 46 it
  // was the heaviest thing on the card and pulled the eye off the board's name.
  main: { flex: 1, gap: spacing[1] },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  title: { flexShrink: 1 },
  stats: { flexDirection: "row", alignItems: "center", gap: spacing[3], flexWrap: "wrap" },
  stat: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
});
