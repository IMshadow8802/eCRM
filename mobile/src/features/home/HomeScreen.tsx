import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  AlarmClock,
  Bell,
  CalendarClock,
  ClipboardCheck,
  Flame,
  Headset,
  Lock,
  TrendingUp,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { StackNavigationProp } from "@react-navigation/stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchFollowUps } from "../../api/followupQueries";
import { fetchLeads } from "../../api/leadQueries";
import { fetchTickets } from "../../api/ticketQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import { colors, fontFamily, radius, spacing, SCREEN_PADDING, TAB_BAR_CLEARANCE } from "../../theme";
import { EmptyState, MenuList, Refresher, Screen, Text, type MenuListRow } from "../../ui";
import { useAccess } from "../auth/useAccess";
import { useUnreadCount } from "../notifications/useUnreadCount";
import { followUpViewParams, leadQueueParams } from "../sales/leadHelpers";
import { complaintQueueParams } from "../support/ticketHelpers";
import { longDate } from "../tasks/greeting";
import { MY_DAY_QUERY, myTasksQuery, needsYou } from "../tasks/taskHelpers";

type Nav = StackNavigationProp<RootStackParamList>;

interface Row extends Omit<MenuListRow, "detail"> {
  /** undefined = loading, failed or not asked: only a real reply may say "nothing". */
  value: number | undefined;
  some: (n: number) => string;
  none: string;
  neutral: string;
}

const detail = (r: Row) => (r.value == null ? r.neutral : r.value ? r.some(r.value) : r.none);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A count, not a list: page size 1, read the total. */
const total = (r: { data?: { pagination: { totalRecords: number } } | null } | undefined) =>
  r?.data?.pagination.totalRecords;

/**
 * Home — "Today" across whatever the person works on. Every number is the
 * first page of a list's own filter (the same params builder the list uses),
 * and tapping it opens that list on that filter, so the two always agree.
 * A module the role cannot view is neither shown nor asked for — its
 * endpoint would only 403.
 */
export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.UserId);
  const unread = useUnreadCount();

  const canTasks = useAccess("tasks").view;
  const canComplaints = useAccess("complaints").view;
  const canLeads = useAccess("leads").view;
  // Without a user id a "mine" filter is null — the whole reach, not yours.
  const signedIn = userId != null;

  // The exact queries My Work runs, so they share a cache entry with it.
  const myTasks = useQuery({ ...myTasksQuery(userId), enabled: canTasks && signedIn });
  const myDay = useQuery({ ...MY_DAY_QUERY, enabled: canTasks });

  const mineTickets = complaintQueueParams("mine", "active", userId, "");
  const overdueTickets = complaintQueueParams("overdue", "active", userId, "");
  const ticketsMine = useQuery({
    queryKey: ["tickets", "count", mineTickets],
    queryFn: () => fetchTickets({ ...mineTickets, PageSize: 1 }),
    enabled: canComplaints && signedIn,
  });
  const ticketsOverdue = useQuery({
    queryKey: ["tickets", "count", overdueTickets],
    queryFn: () => fetchTickets({ ...overdueTickets, PageSize: 1 }),
    enabled: canComplaints,
  });

  const mineLeads = leadQueueParams("mine", "all", userId ?? 0, "");
  const leadsMine = useQuery({
    queryKey: ["leads", "count", mineLeads],
    queryFn: () => fetchLeads({ ...mineLeads, PageSize: 1 }),
    enabled: canLeads && signedIn,
  });
  const today = followUpViewParams("today");
  const dueToday = useQuery({
    queryKey: ["followups", "count", today],
    queryFn: () => fetchFollowUps({ ...today, PageSize: 1 }),
    enabled: canLeads,
  });

  // Every count the role may see; a disabled query (no access) is skipped.
  const counts = [myTasks, myDay, ticketsMine, ticketsOverdue, leadsMine, dueToday];
  const refreshing = counts.some((q) => q.isRefetching && !q.isLoading);
  const refresh = () => {
    for (const [q, on] of [
      [myTasks, canTasks && signedIn],
      [myDay, canTasks],
      [ticketsMine, canComplaints && signedIn],
      [ticketsOverdue, canComplaints],
      [leadsMine, canLeads && signedIn],
      [dueToday, canLeads],
    ] as const) {
      if (on) void q.refetch();
    }
  };

  // Both task rows open "Mine": My Work shows "Needs you" only there.
  const toTasks = () => navigation.navigate("Tabs", { screen: "Tasks", params: { filter: "mine" } });

  const groups = ([
    canTasks
      ? [
          {
            key: "tasks",
            icon: ClipboardCheck,
            tint: "primary",
            label: "My tasks",
            // The total, not the page: the list is capped at 200 rows.
            value: total(myTasks.data),
            some: (n) => `${plural(n, "task")} assigned to you`,
            none: "Nothing assigned to you",
            neutral: "Tasks assigned to you",
            onPress: toTasks,
          },
          {
            key: "needs",
            icon: Flame,
            tint: "danger",
            label: "Needs you",
            value: myDay.data ? needsYou(myDay.data.data).length : undefined,
            some: (n) => `${plural(n, "task")} past or near a deadline`,
            none: "Nothing needs you",
            neutral: "Deadlines and reasons owed",
            onPress: toTasks,
          },
        ]
      : [],
    canComplaints
      ? [
          {
            key: "complaints-mine",
            icon: Headset,
            tint: "danger",
            label: "My complaints",
            value: total(ticketsMine.data),
            some: (n) => `${n} open`,
            none: "Nothing open on you",
            neutral: "Complaints assigned to you",
            onPress: () => navigation.navigate("Complaints", { queue: "mine" }),
          },
          {
            key: "complaints-overdue",
            icon: AlarmClock,
            tint: "warning",
            label: "Overdue complaints",
            value: total(ticketsOverdue.data),
            some: (n) => `${n} overdue`,
            none: "Nothing overdue",
            neutral: "Past their due time",
            onPress: () => navigation.navigate("Complaints", { queue: "overdue" }),
          },
        ]
      : [],
    canLeads
      ? [
          {
            key: "leads-mine",
            icon: TrendingUp,
            tint: "success",
            label: "My leads",
            value: total(leadsMine.data),
            some: (n) => `${n} yours`,
            none: "No leads yet",
            neutral: "Leads you own",
            onPress: () => navigation.navigate("Leads", { queue: "mine" }),
          },
          {
            key: "followups-today",
            icon: CalendarClock,
            tint: "warning",
            label: "Follow-ups due today",
            value: total(dueToday.data),
            some: (n) => `${n} due today`,
            none: "Nothing due today",
            neutral: "Calls and visits to make",
            // A tab, or pushed from the stack when the bar has no room — the
            // navigator that has the route answers.
            onPress: () => navigation.navigate("FollowUps", { view: "today" }),
          },
        ]
      : [],
  ] satisfies Row[][]).filter((g) => g.length > 0);

  return (
    <Screen>
      <View style={[styles.header, { paddingTop: insets.top + spacing[3] }]}>
        <View style={styles.titleBlock}>
          <Text variant="h1">Today</Text>
          <Text variant="caption" color="textMuted">
            {longDate()}
          </Text>
        </View>
        <Pressable
          onPress={() => navigation.navigate("Inbox")}
          accessibilityRole="button"
          accessibilityLabel="Inbox"
          accessibilityValue={unread > 0 ? { text: `${unread} unread` } : undefined}
          hitSlop={spacing[2]}
          style={({ pressed }) => [styles.bell, pressed && styles.bellPressed]}
        >
          <Bell size={20} color={colors.text} />
          {unread > 0 ? (
            <View style={styles.badge}>
              <Text variant="caption" color="textOnBrand" style={styles.badgeText}>
                {unread > 99 ? "99+" : String(unread)}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      <ScrollView
        testID="home-list"
        contentContainerStyle={[styles.content, !groups.length && styles.contentEmpty]}
        showsVerticalScrollIndicator={false}
        refreshControl={<Refresher refreshing={refreshing} onRefresh={refresh} />}
      >
        {groups.map((rows) => (
          <MenuList key={rows[0]!.key} rows={rows.map((r) => ({ ...r, detail: detail(r) }))} />
        ))}

        {!groups.length ? (
          <EmptyState
            icon={Lock}
            title="Nothing here yet"
            message="You do not have access to any modules. Ask an administrator to grant you one."
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const BELL = 42;

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: SCREEN_PADDING,
    paddingBottom: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  titleBlock: { flex: 1, gap: spacing[1] },
  bell: {
    width: BELL,
    height: BELL,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  bellPressed: { backgroundColor: colors.surfacePressed },
  badge: {
    position: "absolute",
    top: -spacing[1],
    right: -spacing[1],
    minWidth: spacing[5],
    paddingHorizontal: spacing[1],
    borderRadius: radius.full,
    backgroundColor: colors.danger,
    alignItems: "center",
  },
  badgeText: { fontFamily: fontFamily.semibold },
  content: { padding: SCREEN_PADDING, gap: spacing[5], paddingBottom: TAB_BAR_CLEARANCE },
  contentEmpty: { flexGrow: 1 },
});
