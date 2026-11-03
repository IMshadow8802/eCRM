import { useRef } from "react";
import { StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Inbox, Key, LayoutDashboard, LogOut, ShieldCheck, User } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { StackNavigationProp } from "@react-navigation/stack";

import { fetchFollowUps } from "../../api/followupQueries";
import { fetchBranches } from "../../api/userQueries";
import { fetchWorkspaces } from "../../api/workspaceQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import { useTabs } from "../../navigation/tabs";
import useAuthStore from "../../stores/useAuthStore";
import { moduleTones, spacing, type ChipTone } from "../../theme";
import {
  Avatar, Band, BandSheet, Chip, CountBadge, Dialog, Footnote, ListGroup, ListRow, Screen, Text, type SheetRef,
} from "../../ui";
import { appVersion } from "../auth/appVersion";
import { useAccess } from "../auth/useAccess";
import { useSignOut } from "../auth/useSignOut";
import { useUnreadCount } from "../notifications/useUnreadCount";
import { isMyWorkspace } from "../tasks/taskHelpers";
import { clockTime } from "../notifications/timeLabels";
import { ChangePasswordSheet } from "../profile/AccountForms";
import { followUpViewParams } from "../sales/leadHelpers";

type Nav = StackNavigationProp<RootStackParamList>;

/** "A", "A and B", "A, B and C". */
const listOf = (names: string[]) =>
  names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * E 19 / 26: the profile hub. Everything that is not a tab — the Inbox,
 * workspaces, Follow-ups when the bar has no room — then the account rows.
 */
export default function MoreScreen() {
  const navigation = useNavigation<Nav>();
  const unread = useUnreadCount();
  const user = useAuthStore((s) => s.user);
  const userId = useAuthStore((s) => s.UserId);
  const branchId = useAuthStore((s) => s.BranchId);
  const companyName = useAuthStore((s) => s.companyName);
  const loginTimestamp = useAuthStore((s) => s.loginTimestamp);
  const sessionExpiresAt = useAuthStore((s) => s.sessionExpiresAt);
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const can = {
    tasks: useAccess("tasks").view,
    complaints: useAccess("complaints").view,
    leads: useAccess("leads").view,
  };
  const followUpsIsTab = useTabs().includes("FollowUps");
  const showFollowUps = can.leads && !followUpsIsTab;
  const signOut = useSignOut();
  const passwordSheet = useRef<SheetRef>(null);

  // Shared caches: Boards and the complaint form read the same keys.
  const { data: workspaces } = useQuery({
    queryKey: ["workspaces", false],
    queryFn: () => fetchWorkspaces({ PageSize: 100 }),
    enabled: can.tasks,
  });
  const todayParams = followUpViewParams("today");
  const { data: followUpsToday = 0 } = useQuery({
    queryKey: ["followups", "count", todayParams],
    queryFn: () => fetchFollowUps({ ...todayParams, PageSize: 1 }),
    select: (r) => r.data?.pagination.totalRecords ?? 0,
    enabled: showFollowUps,
  });
  // G24: AuthUser has only the id.
  const { data: branches } = useQuery({ queryKey: ["branches"], queryFn: fetchBranches });
  const office = branches?.find((b) => b.Id === branchId)?.BranchName;

  // G23: no group name in the login payload.
  const modules = (["tasks", "complaints", "leads"] as const).filter((m) => can[m]);
  const roleLabel = user?.JobTitle || (isAdmin ? "Admin" : null);
  const roleTone: ChipTone = isAdmin ? "lilac" : modules.length === 1 ? moduleTones[modules[0]!].chip : "indigo";

  const NAMES = { tasks: "Tasks", complaints: "Complaints", leads: "Leads" } as const;
  const missing = [
    ...(["tasks", "complaints", "leads"] as const).filter((m) => !can[m]).map((m) => NAMES[m]),
    ...(can.tasks ? [] : ["Workspaces"]),
    ...(can.leads ? [] : ["Follow-ups"]),
  ];
  const covers = modules.length ? `${listOf(modules.map((m) => NAMES[m]))} only` : "none of the modules";

  const session = loginTimestamp
    ? `Signed in since ${clockTime(new Date(loginTimestamp))}${
        sessionExpiresAt ? ` · session ends ${clockTime(new Date(sessionExpiresAt))}` : ""
      }`
    : null;

  return (
    <Screen band>
      <Band variant="profile" align="center">
        {/* No row above it (Band skips an empty one): the avatar sits 16 under the status bar (E 19). */}
        <View testID="profile-avatar" style={styles.avatar}>
          <Avatar name={user?.FullName} uri={user?.Avatar} userId={userId} size={88} ring="bandField" />
        </View>
        <Text variant="recordTitle" color="textOnBrand" align="center" style={styles.name}>
          {user?.FullName ?? "—"}
        </Text>
        <View style={styles.roleRow}>
          {roleLabel ? <Chip label={roleLabel} tone={roleTone} /> : null}
          <Text variant="meta" color="onBandMuted" numberOfLines={1} style={styles.shrink}>
            {[office, companyName].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </Band>

      <BandSheet scroll>
        <ListGroup>
          <ListRow
            badge={{ tone: "indigo", icon: Inbox }}
            title="Inbox"
            trailing={<CountBadge count={unread} ringColor="surface" />}
            chevron
            menu
            noSeparator
            onPress={() => navigation.navigate("Inbox")}
          />
          {can.tasks ? (
            <ListRow
              badge={{ tone: "lilac", icon: LayoutDashboard }}
              title="Workspaces"
              right={workspaces ? { text: String(workspaces.filter(isMyWorkspace).length) } : undefined}
              chevron
              menu
              onPress={() => navigation.navigate("Boards")}
            />
          ) : null}
          {showFollowUps ? (
            <ListRow
              badge={{ tone: "butter", icon: CalendarClock }}
              title="Follow-ups"
              trailing={followUpsToday > 0 ? <Chip label={`${followUpsToday} today`} tone="butter" /> : null}
              chevron
              menu
              onPress={() => navigation.navigate("FollowUps", undefined)}
            />
          ) : null}
        </ListGroup>

        <ListGroup style={styles.group2}>
          <ListRow
            badge={{ tone: "slate", icon: User }}
            title="Profile"
            chevron
            menu
            noSeparator
            onPress={() => navigation.navigate("Me")}
          />
          <ListRow
            badge={{ tone: "slate", icon: Key }}
            title="Change password"
            chevron
            menu
            onPress={() => passwordSheet.current?.present()}
          />
          <ListRow
            badge={{ tone: "red", icon: LogOut }}
            title="Sign out"
            titleTone="danger"
            menu
            onPress={() => signOut.setConfirming(true)}
          />
        </ListGroup>

        {missing.length ? (
          <Footnote icon={ShieldCheck}>
            {`Your role covers ${covers}, so ${listOf(missing)} ${missing.length === 1 ? "does" : "do"} not appear. Ask your admin if that is wrong.`}
          </Footnote>
        ) : null}

        <View style={styles.footer}>
          <Text variant="small" align="center">{appVersion()}</Text>
          {session ? <Text variant="small" align="center">{session}</Text> : null}
        </View>
      </BandSheet>

      <ChangePasswordSheet ref={passwordSheet} />
      <Dialog
        visible={signOut.confirming}
        title="Sign out?"
        message="You will need your password to sign back in."
        badge={{ tone: "red", icon: LogOut }}
        confirmLabel="Sign out"
        destructive
        loading={signOut.busy}
        onConfirm={signOut.signOut}
        onCancel={() => signOut.setConfirming(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  avatar: { marginTop: spacing[4] },
  name: { marginTop: spacing[3] },
  roleRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing[2], marginTop: 6 },
  shrink: { flexShrink: 1 },
  group2: { marginTop: spacing[3] },
  footer: { marginTop: spacing[5] },
});
