import { useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { StackNavigationProp } from "@react-navigation/stack";

import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../../api/notificationQueries";
import { apiErrorMessage, RECORD_GONE_MESSAGE, recordGone } from "../../api/errors";
import { fetchLeadDetail } from "../../api/leadQueries";
import { fetchTicketDetail } from "../../api/ticketQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import { notificationBadge } from "../../theme";
import type { AppNotification } from "../../types/api";
import {
  Band, BandSheet, EmptyState, ErrorCard, GroupHeader, HeaderButton, ListGroup, ListRow, Screen, SkeletonRows, Text,
  useToast,
} from "../../ui";
import { clockTime, sameDay, shortDate } from "./timeLabels";

const QUERY_KEY = ["notifications"];

/**
 * Open the list, not a record (as web TopNav): a bulk notice carries EntityId 0,
 * stranded_work carries a person's id, and a moved-away one names a record the
 * reader can no longer open.
 */
const LIST_ONLY_TYPE = /_moved_away$|_bulk_|^stranded_work$/;

/** E 18: the band, then Today and Earlier as grouped rows. */
export default function NotificationsScreen() {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const toast = useToast();

  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => fetchNotifications() });
  const items = (query.data?.data?.notifications ?? []).filter((n) => n.Id != null);
  const unreadCount = query.data?.data?.unreadCount ?? 0;

  // A failed refresh with a list already on screen keeps the list (E 20c is for
  // a first load that failed); the toast says the list may be stale.
  const refreshFailed = query.isError && query.data != null;
  const { errorUpdatedAt } = query;
  useEffect(() => {
    if (refreshFailed) toast.error("Could not refresh your inbox.");
  }, [refreshFailed, errorUpdatedAt, toast]);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    [queryClient],
  );

  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not mark them read.")),
    onSuccess: refresh,
  });

  const open = (n: AppNotification) => {
    // Fire-and-forget: opening the thing must not wait on the read receipt.
    // A read row needs no receipt (as NotificationBell.jsx).
    if (!n.IsRead) markNotificationRead(n.Id).then(refresh, () => {});
    // TAT warnings, breaches and holds are about a task whatever EntityType says.
    const entity = n.Type?.startsWith("tat_") ? "task" : String(n.EntityType ?? "").toLowerCase();
    switch (entity) {
      case "task":
        // A sweep notification covers several tasks: EntityId 0, so show the list.
        if (!(n.EntityId > 0)) {
          navigation.navigate("Tabs", { screen: "Tasks" });
          break;
        }
        navigation.navigate("TaskDetail", { taskId: n.EntityId, workspaceId: null });
        break;
      case "ticket":
      case "lead": {
        const ticket = entity === "ticket";
        if (!(n.EntityId > 0) || LIST_ONLY_TYPE.test(n.Type ?? "")) {
          navigation.navigate(ticket ? "Complaints" : "Leads");
          break;
        }
        const id = n.EntityId;
        const go = () =>
          ticket ? navigation.navigate("ComplaintDetail", { ticketId: id }) : navigation.navigate("LeadDetail", { leadId: id });
        // Fetch first (into the detail's own cache key): a record that has left
        // the reader says so here and the Inbox stays; any other failure opens
        // the detail, which shows its own error.
        const fetched: Promise<unknown> = ticket
          ? queryClient.fetchQuery({ queryKey: ["ticket", id], queryFn: () => fetchTicketDetail({ TicketId: id }) })
          : queryClient.fetchQuery({ queryKey: ["lead", id], queryFn: () => fetchLeadDetail({ LeadId: id }) });
        void fetched.then(go, (err: unknown) => (recordGone(err) ? toast.error(RECORD_GONE_MESSAGE) : go()));
        break;
      }
      case "workspace":
        navigation.navigate("Boards");
        break;
      // 149: a hand-out and a due callback are the caller's; open their screen. A missed
      // callback is a manager's notice about someone else's list: read, nothing to open here.
      case "call_list":
      case "call_contact":
        if (n.Type === "call_assigned") navigation.navigate("Calling");
        else if (n.Type === "call_callback_due") navigation.navigate("Calling", { tab: "callbacks" });
        break;
      // "Not signed in yet" is about a person. The web opens Today's team tab;
      // the phone's Today is Home — the one tab every role has.
      case "user":
        navigation.navigate("Tabs", { screen: "Home" });
        break;
    }
  };

  // The local day: a 00:10 IST row is today even though it is yesterday in UTC.
  const now = new Date();
  const today = items.filter((n) => sameDay(new Date(n.CreatedDate), now));
  const earlier = items.filter((n) => !sameDay(new Date(n.CreatedDate), now));

  const row = (n: AppNotification, i: number, isToday: boolean) => {
    const at = new Date(n.CreatedDate);
    return (
      <ListRow
        key={n.Id}
        testID={`notification-${n.Id}`}
        badge={{ ...notificationBadge(n.Type), testID: `badge-${n.Id}` }}
        title={n.Title}
        titleTone={n.IsRead ? "muted" : "default"}
        titleWeight={n.IsRead ? "read" : "strong"}
        right={{ text: isToday ? clockTime(at) : shortDate(at) }}
        meta={n.Body ?? undefined}
        // E 18: the indigo dot ends line 2.
        unreadDot={!n.IsRead}
        align="top"
        unread={!n.IsRead}
        noSeparator={i === 0}
        onPress={() => open(n)}
      />
    );
  };

  const body = query.isLoading ? (
    <ListGroup><SkeletonRows /></ListGroup>
  ) : query.isError && !query.data ? (
    <ErrorCard onRetry={() => void query.refetch()} />
  ) : !items.length ? (
    <EmptyState module="inbox" icon={Bell} title="You're all caught up" />
  ) : (
    <>
      {today.length ? (
        <>
          <GroupHeader label="Today" first />
          <ListGroup testID="inbox-today">{today.map((n, i) => row(n, i, true))}</ListGroup>
        </>
      ) : null}
      {earlier.length ? (
        <>
          <GroupHeader label="Earlier" first={!today.length} />
          <ListGroup testID="inbox-earlier">{earlier.map((n, i) => row(n, i, false))}</ListGroup>
        </>
      ) : null}
    </>
  );

  return (
    <Screen band>
      <Band
        variant="record"
        title="Inbox"
        onBack={navigation.goBack}
        actions={
          unreadCount > 0 ? (
            <HeaderButton
              variant="ghost"
              icon={CheckCheck}
              label="Mark all read"
              disabled={markAll.isPending}
              onPress={() => markAll.mutate()}
            />
          ) : null
        }
      >
        {unreadCount > 0 ? <Text variant="meta" color="onBandMuted" tabular>{`${unreadCount} unread`}</Text> : null}
      </Band>
      <BandSheet
        scroll
        center={!query.isLoading && !(query.isError && !query.data) && !items.length}
        refresh={{ refreshing: query.isRefetching && !query.isLoading, onRefresh: () => void query.refetch() }}
      >
        {body}
      </BandSheet>
    </Screen>
  );
}
