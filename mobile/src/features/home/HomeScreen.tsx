import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { StackNavigationProp } from "@react-navigation/stack";
import { Bell, Clock, Hand, Headset, ListChecks, Lock, Plus, Search, Target, Timer, Users } from "lucide-react-native";

import { fetchLookups, LOOKUP_KIND } from "../../api/configQueries";
import { fetchFollowUps } from "../../api/followupQueries";
import { fetchLeads } from "../../api/leadQueries";
import { fetchNotifications } from "../../api/notificationQueries";
import { fetchTickets } from "../../api/ticketQueries";
import { overdueFollowUpsCountQuery, overdueTicketsCountQuery } from "../../navigation/badges";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import { useCreate } from "../../navigation/Shell";
import useAuthStore from "../../stores/useAuthStore";
import {
  colors, complaintBadge, followUpBadge, metrics, notificationBadge, priorityChip, spacing, type UiModule,
} from "../../theme";
import type { DayTask, FollowUp, Ticket } from "../../types/api";
import {
  Avatar, Band, BandSheet, EmptyState, GroupHeader, HeaderButton, HeroCard, IconButton, ListGroup,
  ListRow, ModuleTile, Screen, SearchField, Text, useLayout, type HeroStat, type ListRowProps,
} from "../../ui";
import { useAccess } from "../auth/useAccess";
import { useUnreadCount } from "../notifications/useUnreadCount";
import { firstOpenStatus, followUpTypeLabel, followUpViewParams, leadCountQuery, leadQueueParams, rupees, type LeadQueue } from "../sales/leadHelpers";
import { complaintCountQuery, complaintQueueParams, type ComplaintQueue } from "../support/ticketHelpers";
import { greetingFor, longDate } from "../tasks/greeting";
import { parseIst } from "../tasks/tatChip";
import { doneThisWeek, dueBucket, MY_DAY_QUERY, myDoneQuery, myTasksQuery, needsYou, shortSpan } from "../tasks/taskHelpers";

type Nav = StackNavigationProp<RootStackParamList>;

/** A count, not a list: read the total. undefined = loading or failed — never a 0. */
const total = (r: { data?: { pagination: { totalRecords: number } } | null } | undefined) =>
  r?.data?.pagination.totalRecords;

/** G3 and G12 read a 200-row page; past it the sum or count would be a guess. */
const PAGE = 200;

/** "6:30 pm" in the phone's zone (IST for every user). */
const clock = (v: string | null | undefined) => {
  const d = parseIst(v);
  return d ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).toLowerCase() : null;
};
/** A follow-up's time; null for one booked for a bare day (midnight), which has none. */
const dueClock = (v: string | null | undefined) => {
  const d = parseIst(v);
  return d && (d.getHours() !== 0 || d.getMinutes() !== 0) ? clock(v) : null;
};

/** A rolling 7 days: ResolvedFrom = 6 days ago 00:00, ResolvedTo = tomorrow 00:00 (exclusive), local Y-M-D (§7.6). */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function resolvedWindow(now = new Date()) {
  const day = (n: number) => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
  return { ResolvedFrom: day(-6), ResolvedTo: day(1) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface Tile {
  module: UiModule;
  title: string;
  subtitle?: string;
  value: number | undefined;
  unit: string;
  onPress: () => void;
}

/**
 * Home "Today" (E 04, 27, T1). Every number is the first page of a list's own
 * filter and opens that list on that filter, so the two always agree; a figure
 * no list can show (Escalated, Resolved, New, Won, Done this week) is not
 * tappable. A module the role cannot view is neither shown nor asked for.
 */
export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const layout = useLayout();
  const tablet = layout.nav === "rail";
  const create = useCreate();
  const userId = useAuthStore((s) => s.UserId);
  const user = useAuthStore((s) => s.user);
  const unread = useUnreadCount();

  const canTasks = useAccess("tasks").view;
  const complaintsAccess = useAccess("complaints");
  const leadsAccess = useAccess("leads");
  const canComplaints = complaintsAccess.view;
  const canLeads = leadsAccess.view;
  // §7.9: a team card only when the reach is wider than Own.
  const wide = (r: string | null) => r != null && r !== "Own";
  // Without a user id a "mine" filter is null — the whole reach, not yours.
  const me = userId != null;
  const hero: "complaints" | "leads" | "tasks" | null = canComplaints ? "complaints" : canLeads ? "leads" : canTasks ? "tasks" : null;

  // ------------------------------------------------------------ tasks
  const myTasks = useQuery({ ...myTasksQuery(userId), enabled: canTasks && me });
  const myDone = useQuery({ ...myDoneQuery(userId), enabled: hero === "tasks" && me });
  // /api/today/mine is open to everyone: the shift row (G21) reads it too.
  const myDay = useQuery(MY_DAY_QUERY);
  const needs = canTasks ? needsYou(myDay.data?.data) : [];

  // ------------------------------------------------------- complaints
  const mineTicketParams = { ...complaintQueueParams("mine", "active", userId, ""), PageSize: PAGE };
  const ticketsMine = useQuery({
    queryKey: ["tickets", "home", mineTicketParams],
    queryFn: () => fetchTickets(mineTicketParams),
    enabled: canComplaints && me,
  });
  // Mine and overdue: the bar badge's request.
  const ticketsOverdue = useQuery({ ...overdueTicketsCountQuery(userId), enabled: canComplaints && me });
  // §7.9 team card: each figure is its preset's own count query (ComplaintsScreen), so it equals the list it opens.
  const teamComplaints = hero === "complaints" && me && wide(complaintsAccess.reach);
  const TEAM_TICKET_QUEUES = ["team", "overdue", "escalated"] as const;
  const ticketsTeam = useQueries({
    queries: TEAM_TICKET_QUEUES.map((q) => ({
      ...complaintCountQuery(complaintQueueParams(q, "active", userId, "")),
      enabled: teamComplaints,
    })),
  });
  const resolvedParams = { AssignedTo: userId, ...resolvedWindow(), PageSize: 1 };
  // Until SQL 118 is applied the SP rejects the params: the figure stays "—" (§7.6).
  const ticketsResolved = useQuery({
    queryKey: ["tickets", "count", resolvedParams],
    queryFn: () => fetchTickets(resolvedParams),
    enabled: canComplaints && me,
    retry: false,
  });
  const mineTickets = ticketsMine.data?.data;
  // G12: my non-terminal complaints with EscalatedTo set — counted off the
  // "mine, active" page; past 200 rows it would undercount, so "—".
  const escalated = mineTickets && mineTickets.pagination.totalRecords <= PAGE
    ? mineTickets.tickets.filter((t) => t.EscalatedTo != null).length
    : undefined;
  const myOverdueTickets = (mineTickets?.tickets ?? []).filter((t) => t.IsOverdue);

  // ------------------------------------------------------------ leads
  const mineLeadParams = { ...leadQueueParams("mine", "all", userId ?? 0, ""), PageSize: PAGE };
  const leadsMine = useQuery({
    queryKey: ["leads", "home", mineLeadParams],
    queryFn: () => fetchLeads(mineLeadParams),
    enabled: canLeads && me,
  });
  // Mine and overdue (§7.9).
  const overdueLeadParams = { ...leadQueueParams("overdue", "all", userId ?? 0, ""), OwnerId: userId, PageSize: 1 };
  const leadsOverdue = useQuery({
    queryKey: ["leads", "count", overdueLeadParams],
    queryFn: () => fetchLeads(overdueLeadParams),
    enabled: hero === "leads" && me,
  });
  const statuses = useQuery({
    queryKey: ["lookups", LOOKUP_KIND.leadStatus],
    queryFn: () => fetchLookups({ Kind: LOOKUP_KIND.leadStatus }),
    enabled: hero === "leads",
  });
  // G1: "New" is the first open-coded status by SortOrder — the Leads screen's own rule.
  const newStatusId = statuses.data ? (firstOpenStatus(statuses.data) ?? undefined) : undefined;
  const newParams = { OwnerId: userId, StatusId: newStatusId ?? null, PageSize: 1 };
  const leadsNew = useQuery({
    queryKey: ["leads", "count", newParams],
    queryFn: () => fetchLeads(newParams),
    enabled: hero === "leads" && me && newStatusId != null,
  });
  const wonParams = { OwnerId: userId, StatusCode: "converted" as const, PageSize: 1 };
  const leadsWon = useQuery({
    queryKey: ["leads", "count", wonParams],
    queryFn: () => fetchLeads(wonParams),
    enabled: hero === "leads" && me,
  });
  // §7.9 team card: the Leads presets' own count queries (All · Overdue · New).
  const teamLeads = hero === "leads" && me && wide(leadsAccess.reach);
  const TEAM_LEAD_QUEUES = ["all", "overdue", "new"] as const;
  const leadsTeam = useQueries({
    queries: TEAM_LEAD_QUEUES.map((q) => {
      const params = q === "new" && newStatusId == null ? null : leadQueueParams(q, "all", userId ?? 0, "", newStatusId ?? null);
      const c = leadCountQuery(params, q);
      return { ...c, enabled: c.enabled && teamLeads };
    }),
  });
  const leadsPage = leadsMine.data?.data;
  // G3: open + qualified value over Mine, hidden past one 200-row page.
  const openValue = leadsPage && leadsPage.pagination.totalRecords <= PAGE
    ? rupees(leadsPage.leads
      .filter((l) => l.StatusCode === "open" || l.StatusCode === "qualified")
      .reduce((sum, l) => sum + (l.EstValue ?? 0), 0))
    : null;

  const todayParams = { ...followUpViewParams("today"), PageSize: 3 };
  const dueToday = useQuery({
    queryKey: ["followups", "home", todayParams],
    queryFn: () => fetchFollowUps(todayParams),
    enabled: canLeads,
  });
  const fuOverdue = useQuery({ ...overdueFollowUpsCountQuery(), enabled: canLeads });
  const overdueRowParams = { ...followUpViewParams("overdue"), PageSize: 3 };
  const fuOverdueRows = useQuery({
    queryKey: ["followups", "home", overdueRowParams],
    queryFn: () => fetchFollowUps(overdueRowParams),
    enabled: canLeads,
  });
  const nextAt = dueClock(dueToday.data?.data?.followups[0]?.DueAt);
  const fuOverdueCount = total(fuOverdue.data);

  // ------------------------------------------------------------ inbox (G27)
  const inbox = useQuery({ queryKey: ["notifications"], queryFn: () => fetchNotifications() });
  const escalations = (inbox.data?.data?.notifications ?? [])
    .filter((n) => !n.IsRead && notificationBadge(n.Type).tone === "lilac").length;

  // ------------------------------------------------------------ navigation
  const toTasks = () => navigation.navigate("Tabs", { screen: "Tasks", params: { filter: "mine" } });
  const toComplaints = (queue: ComplaintQueue) => navigation.navigate("Complaints", { queue });
  const toLeads = (queue: LeadQueue) => navigation.navigate("Leads", { queue });
  // A tab, or pushed when the bar has no room — the navigator that has the route answers.
  const toFollowUps = () => navigation.navigate("FollowUps", { view: "today" });

  // ------------------------------------------------------------ hero
  const now = new Date();
  let heroCard: ReactNode = null;
  if (hero === "complaints") {
    const overdue = total(ticketsOverdue.data);
    heroCard = (
      <HeroCard
        icon={Headset}
        title="My complaints"
        subtitle={overdue != null ? `This week · ${overdue} past their TAT` : "This week"}
        onOpen={() => toComplaints("mine")}
        size={tablet ? "tablet" : "phone"}
        stats={[
          { label: "Open", value: total(ticketsMine.data), onPress: () => toComplaints("mine") },
          // Mine and overdue: no list shows exactly this set, so it is not tappable.
          { label: "Overdue", value: overdue, warn: true },
          { label: "Escalated", value: escalated },
          { label: "Resolved", value: ticketsResolved.isError ? undefined : total(ticketsResolved.data) },
        ]}
      />
    );
  } else if (hero === "leads") {
    heroCard = (
      <HeroCard
        icon={Target}
        title="My leads"
        subtitle={openValue ? `${openValue} open value` : undefined}
        onOpen={() => toLeads("mine")}
        size={tablet ? "tablet" : "phone"}
        stats={[
          // All my leads, whatever the status: the same count as the tile ("yours").
          { label: "Yours", value: total(leadsMine.data), onPress: () => toLeads("mine") },
          { label: "Overdue", value: total(leadsOverdue.data), warn: true },
          { label: "New", value: total(leadsNew.data) },
          { label: "Won", value: total(leadsWon.data) },
        ]}
      />
    );
  } else if (hero === "tasks") {
    const open = myTasks.data?.data?.tasks;
    const stats: HeroStat[] = [
      { label: "Assigned", value: total(myTasks.data), onPress: toTasks },
      { label: "Needs you", value: myDay.data ? needs.length : undefined, onPress: toTasks },
      { label: "Overdue", value: open?.filter((t) => dueBucket(t.DueDate) === "overdue").length, warn: true },
      // G10: past one full 200-row page the count would be a guess, so "—".
      {
        label: "Done",
        value: myDone.data && (myDone.data.data?.pagination.totalRecords ?? 0) <= PAGE
          ? doneThisWeek(myDone.data.data?.tasks ?? []).length
          : undefined,
      },
    ];
    heroCard = (
      <HeroCard
        icon={ListChecks}
        title="My tasks"
        subtitle={myDay.data ? `${plural(needs.length, "needs you", "need you")}` : undefined}
        onOpen={toTasks}
        size={tablet ? "tablet" : "phone"}
        stats={stats}
      />
    );
  }

  // ------------------------------------------------------------ team card (§7.9)
  let teamCard: ReactNode = null;
  if (teamComplaints) {
    teamCard = (
      <HeroCard
        tone="plain"
        testID="team-card"
        icon={Users}
        title="My team"
        onOpen={() => toComplaints("team")}
        size={tablet ? "tablet" : "phone"}
        stats={[
          { label: "Open", value: total(ticketsTeam[0]?.data), onPress: () => toComplaints("team") },
          { label: "Overdue", value: total(ticketsTeam[1]?.data), warn: true, onPress: () => toComplaints("overdue") },
          { label: "Escalated", value: total(ticketsTeam[2]?.data), onPress: () => toComplaints("escalated") },
        ]}
      />
    );
  } else if (teamLeads) {
    teamCard = (
      <HeroCard
        tone="plain"
        testID="team-card"
        icon={Users}
        title="My team"
        onOpen={() => toLeads("all")}
        size={tablet ? "tablet" : "phone"}
        stats={[
          { label: "All", value: total(leadsTeam[0]?.data), onPress: () => toLeads("all") },
          { label: "Overdue", value: total(leadsTeam[1]?.data), warn: true, onPress: () => toLeads("overdue") },
          { label: "New", value: total(leadsTeam[2]?.data), onPress: () => toLeads("new") },
        ]}
      />
    );
  }

  // ------------------------------------------------------------ tiles
  const tasksTile: Tile = {
    module: "tasks", title: "Tasks", subtitle: myDay.data ? plural(needs.length, "needs you", "need you") : undefined,
    value: total(myTasks.data), unit: "assigned to you", onPress: toTasks,
  };
  const fuTile: Tile = {
    module: "followups", title: "Follow-ups",
    subtitle: [nextAt ? `Next at ${nextAt}` : null, tablet && fuOverdueCount ? `${fuOverdueCount} overdue` : null]
      .filter(Boolean).join(" · ") || undefined,
    value: total(dueToday.data), unit: "due today", onPress: toFollowUps,
  };
  const leadsTile: Tile = {
    module: "leads", title: "Leads",
    subtitle: hero === "leads"
      ? (fuOverdueCount != null ? `${plural(fuOverdueCount, "overdue call")}` : undefined)
      : openValue ? `${openValue} in play` : undefined,
    value: total(leadsMine.data), unit: "yours", onPress: () => toLeads("mine"),
  };
  const inboxTile: Tile = {
    module: "inbox", title: "Inbox", subtitle: escalations ? plural(escalations, "escalation") : undefined,
    value: unread, unit: "unread", onPress: () => navigation.navigate("Inbox"),
  };
  const modules = [canTasks, canComplaints, canLeads].filter(Boolean).length;
  let tiles: Tile[];
  if (modules > 1) {
    tiles = [...(canTasks ? [tasksTile] : []), ...(canLeads ? [fuTile, leadsTile] : []), inboxTile];
    // Two columns: an odd count past two leaves a hole; Inbox gives way (the bell carries it).
    if (!tablet && tiles.length > 2 && tiles.length % 2 === 1) tiles = tiles.slice(0, -1);
  } else if (canLeads) tiles = [leadsTile, fuTile];
  else if (canTasks) tiles = [tasksTile, inboxTile];
  else if (canComplaints) tiles = [inboxTile];
  else tiles = [];

  // ------------------------------------------------------------ needs you
  const ticketRow = (t: Ticket): ListRowProps & { key: string } => {
    const due = parseIst(t.DueAt);
    const b = complaintBadge(t.StatusCode);
    return {
      key: `t${t.Id}`,
      badge: { tone: "peach", icon: Headset, escalated: t.EscalatedTo != null },
      title: t.Subject,
      right: { text: due ? `Overdue ${shortSpan(now.getTime() - due.getTime())}` : "Overdue", tone: "danger" },
      number: t.TicketNo,
      meta: t.CustomerName ?? undefined,
      chips: tablet
        ? [
          { label: t.StatusName ?? "Open", tone: b.chip ?? "sky" },
          ...(t.PriorityName ? [{ label: t.PriorityName, ...priorityChip(t.PriorityName) }] : []),
        ]
        : undefined,
      onPress: () => navigation.navigate("ComplaintDetail", { ticketId: t.Id }),
    };
  };
  const taskRow = (t: DayTask): ListRowProps & { key: string } => ({
    key: `k${t.TaskId}`,
    badge: { tone: "lilac", icon: ListChecks },
    title: t.Title,
    right: t.flags.reasonOwed ? { text: tablet ? "Explain delay" : "Explain", tone: "brand" } : undefined,
    meta: [t.WorkspaceName, t.StepsTotal ? `${t.StepsDone} of ${t.StepsTotal} steps` : null].filter(Boolean).join(" · ") || undefined,
    chips: t.flags.overdue || t.flags.reasonOwed
      ? [{ label: tablet ? "Missed deadline" : "Missed", tone: "red", icon: Timer }]
      : [{ label: "At risk", tone: "butter", icon: Timer }],
    onPress: () =>
      navigation.navigate("TaskDetail", {
        taskId: t.TaskId,
        workspaceId: t.WorkspaceId,
        tab: "tat",
        ...(t.flags.reasonOwed && t.TatId ? { explainTatId: t.TatId } : {}),
      }),
  });
  /** `compact` = T1's "Follow-ups today" column: 36 badges, no meta. */
  const followUpRow = (f: FollowUp, overdue: boolean, compact = false): ListRowProps & { key: string } => {
    const b = followUpBadge(f.Type, overdue ? "overdue" : "open");
    const due = parseIst(f.DueAt);
    if (compact) {
      return {
        key: `c${f.Id}`, badge: { tone: b.tone, icon: b.icon, size: 36 }, title: f.LeadName ?? "Follow-up",
        right: { text: dueClock(f.DueAt) ?? "Today" }, onPress: () => navigation.navigate("LeadDetail", { leadId: f.LeadId }),
      };
    }
    return {
      key: `f${f.Id}`,
      badge: { tone: b.tone, icon: b.icon },
      title: f.LeadName ?? "Follow-up",
      right: overdue
        ? { text: `Overdue ${due ? shortSpan(now.getTime() - due.getTime()) : ""}`.trim(), tone: "danger" }
        : { text: dueClock(f.DueAt) ?? "Today" },
      meta: [followUpTypeLabel(f.Type), f.LeadCompany].filter(Boolean).join(" · "),
      onPress: () => navigation.navigate("LeadDetail", { leadId: f.LeadId }),
    };
  };
  const needRows = [
    ...myOverdueTickets.map(ticketRow),
    ...needs.map(taskRow),
    ...(canLeads ? (fuOverdueRows.data?.data?.followups ?? []).map((f) => followUpRow(f, true)) : []),
    ...(hero === "leads" ? (dueToday.data?.data?.followups ?? []).map((f) => followUpRow(f, false)) : []),
  ];
  const needCount =
    myOverdueTickets.length + needs.length + (canLeads ? (fuOverdueCount ?? 0) : 0)
    + (hero === "leads" ? (total(dueToday.data) ?? 0) : 0);
  const seeAll = canTasks ? toTasks : canComplaints ? () => toComplaints("overdue") : toFollowUps;

  const needsBlock = needRows.length ? (
    // E 04: 14 above the header (the bento gap plus the rest).
    <View style={tablet ? undefined : styles.needsTop}>
      <GroupHeader first title="Needs you" count={needCount} link={{ label: "See all", onPress: seeAll }} />
      <ListGroup testID="needs-you">
        {needRows.slice(0, 3).map(({ key, ...r }, i) => <ListRow key={key} {...r} noSeparator={i === 0} />)}
      </ListGroup>
    </View>
  ) : null;

  // ------------------------------------------------------------ refresh
  const refreshable = [myTasks, myDone, myDay, ticketsMine, ticketsOverdue, ticketsResolved, leadsMine, leadsOverdue,
    leadsNew, leadsWon, dueToday, fuOverdue, fuOverdueRows, inbox, ...ticketsTeam, ...leadsTeam];
  const refreshing = refreshable.some((q) => q.isRefetching && !q.isLoading);
  const refresh = () => {
    for (const q of refreshable) if (q.isFetched || q.isError) void q.refetch();
  };

  // ------------------------------------------------------------ band
  const first = (user?.FullName ?? "").split(" ")[0] || "there";
  const shiftEnd = clock(myDay.data?.data?.me?.ShiftEnd);
  const greeting = (
    <View style={styles.greetLine}>
      <Text variant={tablet ? "h1" : "h2"} color="textOnBrand" numberOfLines={1} accessibilityRole="header" style={styles.shrink}>
        {`${greetingFor()}, ${first}`}
      </Text>
      <Hand size={tablet ? 22 : 18} color={colors.greetIcon} />
    </View>
  );
  const newButton = <HeaderButton label={create.label} icon={Plus} onPress={create.open} accessibilityLabel={`New ${create.label.toLowerCase()}`} />;
  const bell = (
    <IconButton icon={Bell} accessibilityLabel={unread ? `Notifications, ${unread} unread` : "Notifications"} badge={unread} onPress={() => navigation.navigate("Inbox")} />
  );

  // E 04 band row: avatar 40 (no ring) + date/greeting, then search · bell (· New on tablet).
  const band = (
    <Band
      variant="home"
      leading={
        <>
          <Avatar name={user?.FullName} uri={user?.Avatar} userId={userId} size={tablet ? 44 : 40} ring={null} />
          <View testID="home-lead" style={styles.flex}>
            <Text variant="small" color="onBandMuted" numberOfLines={1}>
              {tablet && shiftEnd ? `${longDate()} · On shift until ${shiftEnd}` : longDate()}
            </Text>
            {greeting}
          </View>
        </>
      }
      actions={
        <>
          {tablet ? (
            <SearchField placeholder="Search complaints, leads, tasks" width={340} onPress={() => navigation.navigate("Search")} />
          ) : (
            <IconButton icon={Search} accessibilityLabel="Search" onPress={() => navigation.navigate("Search")} />
          )}
          {bell}
          {tablet ? newButton : null}
        </>
      }
    >
      {tablet ? null : (
        <View testID="shift-row" style={styles.shiftRow}>
          {shiftEnd ? (
            <>
              <Clock size={16} color={colors.onBandMuted} />
              <Text variant="meta" color="onBandMuted" tabular style={styles.flex}>{`On shift until ${shiftEnd}`}</Text>
            </>
          ) : <View style={styles.flex} />}
          {newButton}
        </View>
      )}
    </Band>
  );

  // ------------------------------------------------------------ layout
  const tileNode = (t: Tile) => (
    <View key={t.module} style={styles.flex}>
      <ModuleTile {...t} size={tablet ? "tablet" : "phone"} />
    </View>
  );
  const gap = tablet ? metrics.bentoGapTablet : metrics.bentoGap;
  const rows = (list: Tile[], per: number) =>
    Array.from({ length: Math.ceil(list.length / per) }, (_, i) => (
      <View key={i} style={[styles.row, { gap }]}>{list.slice(i * per, i * per + per).map(tileNode)}</View>
    ));

  let body: ReactNode;
  if (!hero) {
    body = (
      <EmptyState
        module="home"
        icon={Lock}
        title="Nothing here yet"
        message="You do not have access to any modules. Ask an administrator to grant you one."
      />
    );
  } else if (tablet) {
    const todayRows = (dueToday.data?.data?.followups ?? []).map((f) => followUpRow(f, false, true));
    body = (
      <View style={{ gap }}>
        <View style={[styles.row, { gap }]}>
          <View style={[styles.flex2, { gap }]}>{heroCard}{teamCard}</View>
          {tiles[0] ? tileNode(tiles[0]) : <View style={styles.flex} />}
        </View>
        {rows(tiles.slice(1), 3)}
        <View style={[styles.row, styles.top, { gap }]}>
          <View style={styles.flex2}>{needsBlock}</View>
          <View style={styles.flex}>
            {canLeads ? (
              <>
                <GroupHeader title="Follow-ups today" link={{ label: "Queue", onPress: toFollowUps }} />
                {todayRows.length ? (
                  <ListGroup>
                    {todayRows.map(({ key, ...r }, i) => <ListRow key={key} {...r} noSeparator={i === 0} />)}
                  </ListGroup>
                ) : (
                  <Text variant="meta">Nothing due today.</Text>
                )}
              </>
            ) : null}
          </View>
        </View>
      </View>
    );
  } else {
    body = (
      <View style={{ gap }}>
        {heroCard}
        {teamCard}
        {rows(tiles, 2)}
        {needsBlock}
      </View>
    );
  }

  return (
    <Screen band>
      {band}
      <BandSheet scroll center={!hero} refresh={{ refreshing, onRefresh: refresh }}>
        <View testID="home-list">{body}</View>
      </BandSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  greetLine: { flexDirection: "row", alignItems: "center", gap: metrics.inlineGap },
  shiftRow: { flexDirection: "row", alignItems: "center", gap: spacing[2], height: spacing[10], marginTop: metrics.nudge },
  needsTop: { marginTop: metrics.rowPadH - metrics.bentoGap },
  shrink: { flexShrink: 1 },
  flex: { flex: 1, minWidth: 0 },
  flex2: { flex: 2, minWidth: 0 },
  row: { flexDirection: "row" },
  top: { alignItems: "flex-start" },
});
