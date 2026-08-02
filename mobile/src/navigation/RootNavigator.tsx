import { StyleSheet } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createStackNavigator } from "@react-navigation/stack";

import LoginScreen from "../features/auth/LoginScreen";
import MyWorkScreen from "../features/tasks/MyWorkScreen";
import BoardsScreen from "../features/workspaces/BoardsScreen";
import MeScreen from "../features/profile/MeScreen";
import TaskDetailScreen from "../features/tasks/TaskDetailScreen";
import useAuthStore from "../stores/useAuthStore";
import { colors, fontFamily, fontSize } from "../theme";

export type RootStackParamList = {
  Login: undefined;
  Tabs: undefined;
  /** Pushed from any tab. Only the id travels — the screen fetches the task. */
  TaskDetail: { taskId: number; workspaceId: number | null };
};

export type TabParamList = {
  MyWork: undefined;
  Boards: undefined;
  Me: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const TAB_ICONS: Record<keyof TabParamList, keyof typeof MaterialIcons.glyphMap> =
  {
    MyWork: "check-circle-outline",
    Boards: "view-column",
    Me: "person-outline",
  };

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        // No navigation header anywhere. Screens render their own title via
        // <PageHeader>, so it scrolls with the content instead of sitting in a
        // fixed chrome bar — see src/ui/PageHeader.tsx.
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: {
          fontFamily: fontFamily.medium,
          fontSize: fontSize.xs,
        },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.divider,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarIcon: ({ color, size }) => (
          <MaterialIcons name={TAB_ICONS[route.name]} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen
        name="MyWork"
        component={MyWorkScreen}
        options={{ title: "My Work" }}
      />
      <Tab.Screen name="Boards" component={BoardsScreen} />
      <Tab.Screen name="Me" component={MeScreen} />
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
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
