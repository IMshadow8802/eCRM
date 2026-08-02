import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createStackNavigator } from "@react-navigation/stack";

import LoginScreen from "../features/auth/LoginScreen";
import MyWorkScreen from "../features/tasks/MyWorkScreen";
import BoardsScreen from "../features/workspaces/BoardsScreen";
import WorkHubScreen from "../features/hub/WorkHubScreen";
import ComingSoonScreen from "../features/hub/ComingSoonScreen";
import MeScreen from "../features/profile/MeScreen";
import TaskDetailScreen from "../features/tasks/TaskDetailScreen";
import useAuthStore from "../stores/useAuthStore";
import FloatingTabBar from "./FloatingTabBar";

export type RootStackParamList = {
  Login: undefined;
  Tabs: undefined;
  /** Pushed from any tab. Only the id travels — the screen fetches the task. */
  TaskDetail: { taskId: number; workspaceId: number | null };
  /** Boards moved off the tab bar and is now reached through the Work hub. */
  Boards: undefined;
  ComingSoon: { title: string; blurb: string };
};

export type TabParamList = {
  MyWork: undefined;
  Work: undefined;
  Me: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();


function Tabs() {
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
      <Tab.Screen
        name="MyWork"
        component={MyWorkScreen}
        options={{ title: "My Work" }}
      />
      <Tab.Screen
        name="Work"
        component={WorkHubScreen}
        options={{ title: "Work" }}
      />
      <Tab.Screen
        name="Me"
        component={MeScreen}
        options={{ title: "Profile" }}
      />
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
            <Stack.Screen name="ComingSoon" component={ComingSoonScreen} />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
