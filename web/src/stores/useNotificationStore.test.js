import { describe, it, expect, beforeEach } from "vitest";
import useNotificationStore from "./useNotificationStore";

describe("useNotificationStore", () => {
  beforeEach(() => {
    useNotificationStore.setState({ unreadCount: 0, lastFetchAt: null });
  });

  it("defaults to 0 unread", () => {
    expect(useNotificationStore.getState().unreadCount).toBe(0);
    expect(useNotificationStore.getState().lastFetchAt).toBeNull();
  });

  it("setUnreadCount updates + stamps lastFetchAt", () => {
    useNotificationStore.getState().setUnreadCount(5);
    const s = useNotificationStore.getState();
    expect(s.unreadCount).toBe(5);
    expect(typeof s.lastFetchAt).toBe("number");
  });

  it("setUnreadCount clamps negative values to 0", () => {
    useNotificationStore.getState().setUnreadCount(-3);
    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });

  it("setUnreadCount coerces non-numeric to 0", () => {
    useNotificationStore.getState().setUnreadCount("abc");
    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });

  it("decrementUnread reduces and floors at 0", () => {
    useNotificationStore.setState({ unreadCount: 3 });
    useNotificationStore.getState().decrementUnread(1);
    expect(useNotificationStore.getState().unreadCount).toBe(2);
    useNotificationStore.getState().decrementUnread(10);
    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });

  it("decrementUnread defaults to 1", () => {
    useNotificationStore.setState({ unreadCount: 5 });
    useNotificationStore.getState().decrementUnread();
    expect(useNotificationStore.getState().unreadCount).toBe(4);
  });

  it("resetUnread zeros count and stamps lastFetchAt", () => {
    useNotificationStore.setState({ unreadCount: 9 });
    useNotificationStore.getState().resetUnread();
    const s = useNotificationStore.getState();
    expect(s.unreadCount).toBe(0);
    expect(typeof s.lastFetchAt).toBe("number");
  });
});
