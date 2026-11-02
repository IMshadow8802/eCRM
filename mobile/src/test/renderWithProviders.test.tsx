import { QueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react-native";

import useAuthStore from "../stores/useAuthStore";
import { Text } from "../ui";
import { makeRoute, renderWithProviders, seedAuth } from "./renderWithProviders";

it("renders inside the providers and reuses a passed QueryClient", async () => {
  const queryClient = new QueryClient();
  const r = await renderWithProviders(<Text>hello</Text>, { queryClient });
  expect(screen.getByText("hello")).toBeOnTheScreen();
  expect(r.queryClient).toBe(queryClient);
});

it("seedAuth resets the store and signs the given user in", () => {
  useAuthStore.setState({ sessionEndedReason: "SESSION_ENDED" });
  seedAuth({ user: { Id: 9 }, access: { isAdmin: true }, permissions: { hasAdminAccess: true } });
  const s = useAuthStore.getState();
  expect(s).toMatchObject({ isAuthenticated: true, UserId: 9, sessionEndedReason: null });
  expect(s.isAdmin()).toBe(true);
  expect(s.permissions?.hasAdminAccess).toBe(true);

  seedAuth();
  expect(useAuthStore.getState()).toMatchObject({ UserId: 1, CompId: 1, BranchId: 1, access: null });
});

it("makeRoute builds a typed route", () => {
  expect(makeRoute("TaskDetail", { taskId: 5, workspaceId: null })).toMatchObject({
    name: "TaskDetail",
    params: { taskId: 5 },
  });
});
