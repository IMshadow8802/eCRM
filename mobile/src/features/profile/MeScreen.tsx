import { useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  Briefcase,
  Building2,
  CircleCheckBig,
  ClipboardList,
  Contact,
  LayoutDashboard,
  LogOut,
  Mail,
  ShieldCheck,
  Smartphone,
  type LucideIcon,
} from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchTasks } from "../../api/taskQueries";
import { fetchWorkspaces } from "../../api/workspaceQueries";
import useAuthStore from "../../stores/useAuthStore";
import { isAssignee } from "../tasks/taskHelpers";
import { useSignOut } from "../auth/useSignOut";
import {
  colors,
  radius,
  shadows,
  spacing,
  TAB_BAR_CLEARANCE,
} from "../../theme";
import { Avatar, Button, Dialog, Screen, Text } from "../../ui";

export default function MeScreen() {
  const user = useAuthStore((s) => s.user);
  const company = useAuthStore((s) => s.company);
  const userId = useAuthStore((s) => s.UserId);
  const insets = useSafeAreaInsets();
  const signOut = useSignOut();

  // Both already cached by My Work and Boards, so opening this tab is free.
  const { data: taskData } = useQuery({
    queryKey: ["tasks", "all-workspaces"],
    queryFn: () => fetchTasks({ WorkspaceId: null, PageSize: 200 }),
  });
  const { data: workspaces } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => fetchWorkspaces({ PageSize: 100 }),
  });

  const stats = useMemo(() => {
    const tasks = taskData?.data?.tasks ?? [];
    const mine = tasks.filter((t) => isAssignee(t, userId));
    return {
      assigned: mine.length,
      done: mine.filter((t) => t.IsCompleted).length,
      boards: (workspaces ?? []).filter(
        (w) => w.MyInviteStatus !== "pending" && !w.IsArchived,
      ).length,
    };
  }, [taskData, workspaces, userId]);

  return (
    <Screen>
      <View style={[styles.header, { paddingTop: insets.top + spacing[3] }]}>
        <Text variant="h1">Profile</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.identity}>
          <Avatar name={user?.FullName} uri={user?.Avatar} size={80} />
          <Text variant="h1">{user?.FullName ?? "—"}</Text>
          {user?.JobTitle ? (
            <View style={styles.stat}>
              <Briefcase size={14} color={colors.textSecondary} />
              <Text variant="secondary">{user.JobTitle}</Text>
            </View>
          ) : null}
          {user?.IsAdmin ? (
            <View style={styles.adminBadge}>
              <ShieldCheck size={13} color={colors.textOnBrand} />
              <Text variant="caption" color="textOnBrand">Administrator</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.statRow}>
          <StatTile Icon={ClipboardList} tint="primary" value={stats.assigned} label="Assigned" />
          <StatTile Icon={CircleCheckBig} tint="success" value={stats.done} label="Completed" />
          <StatTile Icon={LayoutDashboard} tint="info" value={stats.boards} label="Boards" />
        </View>

        <View style={styles.group}>
          <Text variant="overline" color="textMuted" style={styles.groupTitle}>
            Account
          </Text>
          <View style={styles.card}>
            {user?.Email ? (
              <Row Icon={Mail} tint="info" label="Email" value={user.Email} />
            ) : null}
            {user?.Mobile ? (
              <Row Icon={Smartphone} tint="success" label="Mobile" value={user.Mobile} />
            ) : null}
            {user?.Username ? (
              <Row Icon={Contact} tint="primary" label="Username" value={user.Username} last={!company?.CompName} />
            ) : null}
            {company?.CompName ? (
              <Row Icon={Building2} tint="neutralIcon" label="Company" value={company.CompName} last />
            ) : null}
          </View>
        </View>

        <Button
          title="Sign out"
          variant="danger"
          icon={LogOut}
          onPress={() => signOut.setConfirming(true)}
          fullWidth
        />

        <View style={styles.footer}>
          <Text variant="caption" align="center">PRD Infotech Pvt Ltd</Text>
          <Text variant="caption" color="textMuted" align="center">
            Nexus CRM · v1.0.0
          </Text>
        </View>
      </ScrollView>

      <Dialog
        visible={signOut.confirming}
        title="Sign out?"
        message="You will need your password to sign back in."
        confirmLabel="Sign out"
        destructive
        loading={signOut.busy}
        onConfirm={signOut.signOut}
        onCancel={() => signOut.setConfirming(false)}
      />
    </Screen>
  );
}

function StatTile({
  Icon,
  tint,
  value,
  label,
}: {
  Icon: LucideIcon;
  tint: keyof typeof colors;
  value: number;
  label: string;
}) {
  return (
    <View style={styles.tile}>
      <View style={[styles.tileGlyph, { backgroundColor: colors[tint] }]}>
        <Icon size={18} color={colors.textOnBrand} />
      </View>
      <Text variant="h2">{value}</Text>
      <Text variant="caption" color="textMuted">{label}</Text>
    </View>
  );
}

function Row({
  Icon,
  tint,
  label,
  value,
  last = false,
}: {
  Icon: LucideIcon;
  tint: keyof typeof colors;
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <View style={[styles.rowGlyph, { backgroundColor: colors[tint] }]}>
        <Icon size={16} color={colors.textOnBrand} />
      </View>
      <View style={styles.rowText}>
        <Text variant="caption" color="textMuted">{label}</Text>
        <Text variant="body" numberOfLines={1}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[3],
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  scroll: {
    padding: spacing[5],
    gap: spacing[5],
    paddingBottom: TAB_BAR_CLEARANCE,
  },
  identity: { alignItems: "center", gap: spacing[2] },
  stat: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  adminBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.full,
    marginTop: spacing[1],
  },
  statRow: { flexDirection: "row", gap: spacing[3] },
  tile: {
    flex: 1,
    alignItems: "center",
    gap: spacing[1],
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingVertical: spacing[4],
    ...shadows.md,
  },
  tileGlyph: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing[1],
  },
  group: { gap: spacing[2] },
  groupTitle: { paddingHorizontal: spacing[1] },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    ...shadows.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    padding: spacing[4],
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  rowGlyph: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1 },
  footer: { gap: spacing[1] },
});
