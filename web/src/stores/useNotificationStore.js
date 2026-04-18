// stores/useNotificationStore.js
//
// Lightweight bell state. The notification list itself is fetched via
// useApiQuery against /api/notifications/fetchNotifications — this store
// holds only the unread badge count and the last-fetch timestamp so the
// bell can update without re-rendering every page.

import { create } from "zustand";

const useNotificationStore = create((set) => ({
  unreadCount: 0,
  lastFetchAt: null,

  setUnreadCount: (n) =>
    set({
      unreadCount: Math.max(0, Number(n) || 0),
      lastFetchAt: Date.now(),
    }),

  decrementUnread: (by = 1) =>
    set((state) => ({
      unreadCount: Math.max(0, state.unreadCount - by),
    })),

  resetUnread: () =>
    set({ unreadCount: 0, lastFetchAt: Date.now() }),
}));

export default useNotificationStore;
