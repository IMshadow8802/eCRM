import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createStackNavigator } from "@react-navigation/stack";

import LoginScreen from "../features/auth/LoginScreen";
import MyWorkScreen from "../features/tasks/MyWorkScreen";
import BoardsScreen from "../features/workspaces/BoardsScreen";
import MeScreen from "../features/profile/MeScreen";
import TaskDetailScreen from "../features/tasks/TaskDetailScreen";
import useAuthStore from "../stores/useAuthStore";
import {
  colors,
  fontFamily,
  fontSize,
  radius,
  shadows,
  spacing,
  TAB_BAR_HEIGHT,
} from "../theme";

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
  // The bar floats, so it must clear the home indicator / nav buttons itself.
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        // No navigation header anywhere. Screens render their own title via
        // <PageHeader>, so it scrolls with the content instead of sitting in a
        // fixed chrome bar — see src/ui/PageHeader.tsx.
        headerShown: false,
        // Solid brand bar. Inactive uses a solid lighter brand shade rather
        // than a translucent white, per the no-transparency rule.
        tabBarActiveTintColor: colors.textOnBrand,
        tabBarInactiveTintColor: colors.textOnBrandMuted,
        tabBarLabelStyle: {
          // Regular, not the app's Medium baseline: white on a saturated fill
          // optically gains weight, and at 11px Medium reads as bold.
          fontFamily: fontFamily.regular,
          fontSize: fontSize.xs,
        },
        // Detached island rather than a bar welded to the bottom edge: the
        // content scrolls under it, which is why screens reserve
        // TAB_BAR_CLEARANCE at the end of their lists.
        tabBarStyle: {
          position: "absolute",
          left: spacing[4],
          right: spacing[4],
          bottom: insets.bottom + spacing[2],
          height: TAB_BAR_HEIGHT,
          paddingBottom: 0,
          paddingTop: 0,
          borderRadius: radius.xl,
          borderTopWidth: 0,
          backgroundColor: colors.primary,
          ...shadows.lg,
        },
        tabBarItemStyle: { height: TAB_BAR_HEIGHT, paddingVertical: spacing[2] },
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
