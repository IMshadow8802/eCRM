import { ScrollView, StyleSheet, View } from "react-native";
import { Bell, CalendarClock, LayoutDashboard, UserRound } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { StackNavigationProp } from "@react-navigation/stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { RootStackParamList } from "../../navigation/RootNavigator";
import { useTabs } from "../../navigation/tabs";
import { colors, spacing, SCREEN_PADDING, TAB_BAR_CLEARANCE } from "../../theme";
import { MenuList, Screen, Text, type MenuListRow } from "../../ui";
import { useAccess } from "../auth/useAccess";
import { useUnreadCount } from "../notifications/useUnreadCount";

type Nav = StackNavigationProp<RootStackParamList>;

/**
 * Everything that is not a tab: the Inbox, task workspaces (boards live only
 * inside Tasks), Follow-ups when the bar has no room for it, and Profile.
 * Each opens on the stack, with a back button.
 */
export default function MoreScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const unread = useUnreadCount();
  const canTasks = useAccess("tasks").view;
  const canLeads = useAccess("leads").view;
  const followUpsIsTab = useTabs().includes("FollowUps");

  const rows: MenuListRow[] = [
    {
      key: "inbox",
      icon: Bell,
      tint: "primary",
      label: "Inbox",
      detail: unread > 0 ? `${unread} unread` : "Your notifications",
      onPress: () => navigation.navigate("Inbox"),
    },
    ...(canTasks
      ? [
          {
            key: "workspaces",
            icon: LayoutDashboard,
            tint: "primary" as const,
            label: "Workspaces",
            detail: "Boards, members and columns",
            onPress: () => navigation.navigate("Boards"),
          },
        ]
      : []),
    ...(canLeads && !followUpsIsTab
      ? [
          {
            key: "followups",
            icon: CalendarClock,
            tint: "warning" as const,
            label: "Follow-ups",
            detail: "Calls and visits to make",
            onPress: () => navigation.navigate("FollowUps", undefined),
          },
        ]
      : []),
    {
      key: "profile",
      icon: UserRound,
      tint: "primary",
      label: "Profile",
      detail: "Your account and password",
      onPress: () => navigation.navigate("Me"),
    },
  ];

  return (
    <Screen>
      <View style={[styles.header, { paddingTop: insets.top + spacing[3] }]}>
        <Text variant="h1">More</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <MenuList rows={rows} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: SCREEN_PADDING,
    paddingBottom: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  content: { padding: SCREEN_PADDING, paddingBottom: TAB_BAR_CLEARANCE },
});
