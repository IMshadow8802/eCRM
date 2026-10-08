import { useCallback } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CheckCheck,
  CircleCheck,
  CloudOff,
  MessageCircle,
  RotateCcw,
  Ticket,
  Unlock,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { StackNavigationProp } from "@react-navigation/stack";

import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../../api/notificationQueries";
import { apiErrorMessage } from "../../api/errors";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import type { AppNotification } from "../../types/api";
import { colors, radius, spacing, SCREEN_PADDING, TAB_BAR_CLEARANCE } from "../../theme";
import { Card, EmptyState, Refresher, Screen, ScreenHeader, Text, useToast } from "../../ui";
import { relativeTime } from "../tasks/taskHelpers";

const QUERY_KEY = ["notifications"];

function iconFor(type: string): LucideIcon {
  if (type.includes("assigned") && type.startsWith("task")) return UserPlus;
  if (type.includes("completed")) return CircleCheck;
  if (type.includes("reopened")) return RotateCcw;
  if (type.includes("unblocked")) return Unlock;
  if (type.includes("comment") || type === "reply") return MessageCircle;
  if (type.startsWith("ticket")) return Ticket;
  if (type.startsWith("workspace")) return Users;
  return Bell;
}

export default function NotificationsScreen() {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const toast = useToast();

  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => fetchNotifications() });
  const items = (query.data?.data?.notifications ?? []).filter((n) => n.Id != null);
  const unreadCount = query.data?.data?.unreadCount ?? 0;

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
    markNotificationRead(n.Id).then(refresh, () => {});
    // TAT warnings, breaches and holds are about a task whatever EntityType says.
    const entity = n.Type?.startsWith("tat_") ? "task" : n.EntityType.toLowerCase();
    switch (entity) {
      case "task":
        // A sweep notification covers several tasks: EntityId 0, so show the list.
        if (!(n.EntityId > 0)) {
          navigation.navigate("Tabs", { screen: "MyWork" });
          break;
        }
        navigation.navigate("TaskDetail", { taskId: n.EntityId, workspaceId: null });
        break;
      case "ticket":
        navigation.navigate("ComplaintDetail", { ticketId: n.EntityId });
        break;
      case "workspace":
        navigation.navigate("Boards");
        break;
    }
  };

  return (
    <Screen>
      <ScreenHeader
        title="Inbox"
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : undefined}
        actions={
          unreadCount > 0
            ? [{ icon: CheckCheck, label: "Mark all read", onPress: () => markAll.mutate() }]
            : undefined
        }
      />
      <FlatList
        data={items}
        keyExtractor={(n) => String(n.Id)}
        contentContainerStyle={[styles.list, !items.length && styles.listEmpty]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <Refresher refreshing={query.isRefetching && !query.isLoading} onRefresh={query.refetch} />
        }
        renderItem={({ item }) => {
          const Icon = iconFor(item.Type);
          return (
            <View style={styles.cardWrap}>
              <Card onPress={() => open(item)} gap={1}>
                <View style={styles.row}>
                  <Icon size={18} color={item.IsRead ? colors.textMuted : colors.primary} />
                  <Text variant="h3" style={styles.title}>
                    {item.Title}
                  </Text>
                  {!item.IsRead ? <View style={styles.dot} /> : null}
                </View>
                {item.Body ? <Text variant="secondary">{item.Body}</Text> : null}
                <Text variant="caption" color="textMuted">
                  {relativeTime(item.CreatedDate)}
                </Text>
              </Card>
            </View>
          );
        }}
        ListEmptyComponent={
          query.isLoading ? null : (
            <EmptyState
              icon={query.isError ? CloudOff : Bell}
              title={query.isError ? "Couldn't load your inbox" : "You're all caught up"}
              message={query.isError ? "Pull down to try again." : undefined}
            />
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingTop: spacing[4], paddingBottom: TAB_BAR_CLEARANCE },
  listEmpty: { flexGrow: 1 },
  cardWrap: { paddingHorizontal: SCREEN_PADDING, paddingBottom: spacing[4] },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  title: { flex: 1 },
  dot: { width: spacing[2], height: spacing[2], borderRadius: radius.full, backgroundColor: colors.primary },
});
