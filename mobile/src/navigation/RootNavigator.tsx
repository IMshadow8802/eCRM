import { NavigationContainer, type NavigatorScreenParams } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createStackNavigator, type StackScreenProps } from "@react-navigation/stack";

import LoginScreen from "../features/auth/LoginScreen";
import HomeScreen from "../features/home/HomeScreen";
import MoreScreen from "../features/home/MoreScreen";
import MyWorkScreen from "../features/tasks/MyWorkScreen";
import BoardsScreen from "../features/workspaces/BoardsScreen";
import BoardScreen from "../features/workspaces/BoardScreen";
import ColumnsScreen from "../features/workspaces/ColumnsScreen";
import WorkspaceFormScreen from "../features/workspaces/WorkspaceFormScreen";
import WorkspaceSettingsScreen from "../features/workspaces/WorkspaceSettingsScreen";
import TaskFormScreen from "../features/tasks/TaskFormScreen";
import ComplaintsScreen from "../features/support/ComplaintsScreen";
import ComplaintDetailScreen from "../features/support/ComplaintDetailScreen";
import ComplaintFormScreen from "../features/support/ComplaintFormScreen";
import LeadsScreen from "../features/sales/LeadsScreen";
import LeadDetailScreen from "../features/sales/LeadDetailScreen";
import LeadFormScreen from "../features/sales/LeadFormScreen";
import FollowUpsScreen from "../features/sales/FollowUpsScreen";
import NotificationsScreen from "../features/notifications/NotificationsScreen";
import MeScreen from "../features/profile/MeScreen";
import TaskDetailScreen from "../features/tasks/TaskDetailScreen";
import useAuthStore from "../stores/useAuthStore";
import FloatingTabBar from "./FloatingTabBar";
import { useTabs, type TabName } from "./tabs";
import type { ComplaintQueue } from "../features/support/ticketHelpers";
import type { FollowUpView, LeadQueue } from "../features/sales/leadHelpers";

export type RootStackParamList = {
  Login: undefined;
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  /** Pushed from any tab. Only the id travels — the screen fetches the task. */
  /**
   * `tab: "tat"` opens on the Deadline tab (My Work's "Needs you");
   * `explainTatId` also opens the reason sheet on that clock.
   */
  TaskDetail: { taskId: number; workspaceId: number | null; tab?: "tat"; explainTatId?: number };
  /** Workspaces, reached from More. Boards live only inside Tasks. */
  Boards: undefined;
  /** One workspace's kanban. `name` is passed so the header has a title
   *  before the columns arrive. */
  Board: { workspaceId: number; name: string };
  /** Omit `taskId` to create. `columnId` seeds the column when opened from a
   *  board, so a new card lands where the user tapped +. */
  TaskForm: { workspaceId: number; taskId?: number; columnId?: number | null };
  /** Omit `workspaceId` to create a new workspace. */
  WorkspaceForm: { workspaceId?: number };
  WorkspaceSettings: { workspaceId: number };
  Columns: { workspaceId: number };
  /**
   * Complaints and Leads are TABS (TabParamList); they are listed here too so
   * any screen can navigate() to them with a filter — the tab navigator
   * answers. Follow-ups is both: a tab when the bar has room, else pushed.
   */
  Complaints: { queue?: ComplaintQueue } | undefined;
  ComplaintDetail: { ticketId: number };
  /** Omit `ticketId` to log a new one. */
  ComplaintForm: { ticketId?: number };
  Leads: { queue?: LeadQueue } | undefined;
  LeadDetail: { leadId: number };
  /** Omit `leadId` to add a new one. */
  LeadForm: { leadId?: number };
  FollowUps: { view?: FollowUpView } | undefined;
  /** Pushed from More (and Home's bell). */
  Inbox: undefined;
  Me: undefined;
};

export type TabParamList = {
  Home: undefined;
  Tasks: undefined;
  Complaints: RootStackParamList["Complaints"];
  Leads: RootStackParamList["Leads"];
  FollowUps: RootStackParamList["FollowUps"];
  More: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();


/** Follow-ups opened from More: same screen, with a back button. */
function PushedFollowUps(props: StackScreenProps<RootStackParamList, "FollowUps">) {
  return <FollowUpsScreen {...props} pushed />;
}

function Tabs() {
  const tabs = useTabs();
  const has = (name: TabName) => tabs.includes(name);
  return (
    <Tab.Navigator
      // The bar itself lives in FloatingTabBar — the default item layout does
      // not survive inside a rounded pill.
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        // No navigation header anywhere. Screens render their own title, so it
        // scrolls with the content instead of sitting in a fixed chrome bar.
        headerShown: false,
      }}
    >
      {/* Which tabs mount is useTabs()'s call; the order here is its order. */}
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: "Home" }} />
      {has("Tasks") ? <Tab.Screen name="Tasks" component={MyWorkScreen} options={{ title: "Tasks" }} /> : null}
      {has("Complaints") ? (
        <Tab.Screen name="Complaints" component={ComplaintsScreen} options={{ title: "Complaints" }} />
      ) : null}
      {has("Leads") ? <Tab.Screen name="Leads" component={LeadsScreen} options={{ title: "Leads" }} /> : null}
      {has("FollowUps") ? (
        <Tab.Screen name="FollowUps" component={FollowUpsScreen} options={{ title: "Follow-ups" }} />
      ) : null}
      <Tab.Screen name="More" component={MoreScreen} options={{ title: "More" }} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  // Auth state decides which tree mounts. Rendering only one branch (rather
  // than navigating between them) means a logout cannot leave an authenticated
  // screen on the stack, and the 401 handler in the api client only has to
  // call logout() to land the user back on Login.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <>
            <Stack.Screen name="Tabs" component={Tabs} />
            <Stack.Screen name="TaskDetail" component={TaskDetailScreen} />
            <Stack.Screen name="Boards" component={BoardsScreen} />
            <Stack.Screen name="Board" component={BoardScreen} />
            <Stack.Screen name="TaskForm" component={TaskFormScreen} />
            <Stack.Screen name="WorkspaceForm" component={WorkspaceFormScreen} />
            <Stack.Screen
              name="WorkspaceSettings"
              component={WorkspaceSettingsScreen}
            />
            <Stack.Screen name="Columns" component={ColumnsScreen} />
            <Stack.Screen
              name="ComplaintDetail"
              component={ComplaintDetailScreen}
            />
            <Stack.Screen name="ComplaintForm" component={ComplaintFormScreen} />
            <Stack.Screen name="LeadDetail" component={LeadDetailScreen} />
            <Stack.Screen name="LeadForm" component={LeadFormScreen} />
            <Stack.Screen name="FollowUps" component={PushedFollowUps} />
            <Stack.Screen name="Inbox" component={NotificationsScreen} />
            <Stack.Screen name="Me" component={MeScreen} />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
