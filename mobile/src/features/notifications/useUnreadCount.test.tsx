import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { fetchNotifications } from "../../api/notificationQueries";
import { envelope, pagination } from "../../test/fixtures";
import { useUnreadCount } from "./useUnreadCount";

jest.mock("../../api/notificationQueries");

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useUnreadCount(), { wrapper });
};

it("reads the count off a one-row page", async () => {
  jest.mocked(fetchNotifications).mockResolvedValue(
    envelope({ notifications: [], unreadCount: 6, pagination: pagination(6) }),
  );
  const { result } = await mount();
  await waitFor(() => expect(result.current).toBe(6));
  expect(fetchNotifications).toHaveBeenCalledWith({ PageSize: 1 });
});

it("a reply without data counts as none", async () => {
  jest.mocked(fetchNotifications).mockResolvedValue({ ...envelope({ notifications: [], unreadCount: 6, pagination: pagination(6) }), data: null });
  const { result } = await mount();
  await waitFor(() => expect(fetchNotifications).toHaveBeenCalled());
  expect(result.current).toBe(0);
});
