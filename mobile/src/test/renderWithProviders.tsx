import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { render } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { NavigationContainer, type RouteProp } from "@react-navigation/native";
import type { StackNavigationProp } from "@react-navigation/stack";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { RootStackParamList } from "../navigation/RootNavigator";
import useAuthStore from "../stores/useAuthStore";
import type { Access, AuthUser, Permissions } from "../types/api";
import { access } from "./fixtures";
import { ToastProvider } from "../ui";

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

type Rendered = Awaited<ReturnType<typeof render>>;

/**
 * Mounts `ui` inside the providers App.tsx gives a screen, in the same order.
 * A fresh QueryClient per call (no retries, no cache, no lingering mutations)
 * unless one is passed.
 */
export async function renderWithProviders(
  ui: ReactElement,
  opts: { queryClient?: QueryClient } = {},
): Promise<Rendered & { queryClient: QueryClient }> {
  const queryClient =
    opts.queryClient ??
    // Mutations too: their default 5-minute gcTime timer keeps jest from exiting.
    new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
    });
  const result = await render(
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider initialMetrics={METRICS}>
        <GestureHandlerRootView style={styles.root}>
          <BottomSheetModalProvider>
            <ToastProvider>
              <NavigationContainer>{ui}</NavigationContainer>
            </ToastProvider>
          </BottomSheetModalProvider>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
  return Object.assign(result, { queryClient });
}

type Nav<R extends keyof RootStackParamList> = StackNavigationProp<RootStackParamList, R>;

/** Stack-navigation prop double: the four methods screens call are jest.fns. */
export function makeNavigation<R extends keyof RootStackParamList>() {
  const mocks = {
    navigate: jest.fn(),
    goBack: jest.fn(),
    replace: jest.fn(),
    push: jest.fn(),
  };
  // ponytail: only these four are real; a screen calling another method gets
  // undefined — add it here when one does.
  return mocks as unknown as Nav<R> & typeof mocks;
}

export const makeRoute = <R extends keyof RootStackParamList>(
  name: R,
  params: RootStackParamList[R],
) => ({ key: `${name}-test`, name, params }) as unknown as RouteProp<RootStackParamList, R>;

/**
 * Signs a user in for a test: resets the auth store to its initial state, then
 * applies `patch`. `UserId` also becomes `user.Id` so either read agrees.
 */
export function seedAuth(
  patch: Partial<{
    UserId: number;
    CompId: number;
    BranchId: number;
    user: Partial<AuthUser>;
    permissions: Partial<Permissions>;
    /** Role grants (built on the fixture default); omitted = not yet known (null). */
    access: Partial<Access>;
  }> = {},
) {
  const UserId = patch.UserId ?? patch.user?.Id ?? 1;
  const store = useAuthStore;
  store.setState(
    {
      ...store.getInitialState(),
      isAuthenticated: true,
      token: "test-token",
      UserId,
      CompId: patch.CompId ?? 1,
      BranchId: patch.BranchId ?? 1,
      user: { Id: UserId, FullName: "Test User", IsAdmin: false, ...patch.user } as AuthUser,
      access: patch.access ? access(patch.access) : null,
      permissions: {
        menuItems: [],
        rawPermissions: [],
        totalMenuItems: 0,
        hasAdminAccess: false,
        ...patch.permissions,
      },
    },
    true,
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
