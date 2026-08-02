import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

import type { Workspace, WorkspaceRole, WorkspaceType } from "../../types/api";
import { colors, radius, shadows, spacing } from "../../theme";
import { Text } from "../../ui";

/** Each workspace type gets its own glyph and colour so the list scans fast. */
const TYPE_META: Record<
  WorkspaceType,
  { icon: keyof typeof MaterialIcons.glyphMap; color: keyof typeof colors; label: string }
> = {
  personal: { icon: "lock", color: "neutralIcon", label: "Personal" },
  shared: { icon: "groups", color: "primary", label: "Shared" },
  project: { icon: "rocket-launch", color: "info", label: "Project" },
};

/** Role decides what you can do, so it is worth showing on the card. */
const ROLE_META: Record<
  WorkspaceRole,
  { icon: keyof typeof MaterialIcons.glyphMap; tone: keyof typeof colors }
> = {
  owner: { icon: "star", tone: "priorityMedium" },
  manager: { icon: "shield", tone: "primary" },
  member: { icon: "edit", tone: "textSecondary" },
  viewer: { icon: "visibility", tone: "textMuted" },
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
        <MaterialIcons name={type.icon} size={22} color={colors.textOnBrand} />
      </View>

      <View style={styles.main}>
        <View style={styles.titleRow}>
          <Text variant="h3" numberOfLines={1} style={styles.title}>
            {workspace.Name}
          </Text>
          {workspace.IsArchived ? (
            <MaterialIcons
              name="inventory-2"
              size={16}
              color={colors.textMuted}
            />
          ) : null}
        </View>

        <View style={styles.stats}>
          <View style={styles.stat}>
            <MaterialIcons
              name={type.icon}
              size={13}
              color={colors[type.color]}
            />
            <Text variant="caption" color={type.color}>
              {type.label}
            </Text>
          </View>

          {/* Personal workspaces are owner-only — a member count there is noise. */}
          {workspace.Type !== "personal" ? (
            <View style={styles.stat}>
              <MaterialIcons name="person" size={13} color={colors.textMuted} />
              <Text variant="caption" color="textMuted">
                {members} member{members === 1 ? "" : "s"}
              </Text>
            </View>
          ) : null}

          {role && workspace.MyRole ? (
            <View style={styles.stat}>
              <MaterialIcons
                name={role.icon}
                size={13}
                color={colors[role.tone]}
              />
              <Text variant="caption" color={role.tone}>
                {workspace.MyRole}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <MaterialIcons name="chevron-right" size={22} color={colors.textMuted} />
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
    ...shadows.md,
  },
  pressed: { transform: [{ scale: 0.985 }] },
  glyph: {
    width: 46,
    height: 46,
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
