import { useEffect, useState } from "react";
import { useTheme } from "@mui/material/styles";
import { Bell } from "lucide-react";

import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import useNotificationStore from "../../stores/useNotificationStore";
import {
  IconButton,
  Badge,
  Popover,
  Button,
  EmptyState,
  Avatar,
} from "../ui";

const POLL_MS = 30_000;

export default function NotificationBell({ onOpenEntity }) {
  const theme = useTheme();
  const p = theme.tokens;
  const [anchorEl, setAnchorEl] = useState(null);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  const resetUnread = useNotificationStore((s) => s.resetUnread);

  const { data: payload, refetch } = useApiQuery({
    queryKey: ["notifications", "bell"],
    endpoint: "/api/notifications/fetchNotifications",
    params: { PageNumber: 1, PageSize: 20, UnreadOnly: false },
    options: { refetchInterval: POLL_MS, refetchOnWindowFocus: true },
    showErrorMessage: false,
  });

  const notifications = payload?.notifications ?? [];
  const unreadCountFromServer = payload?.unreadCount ?? 0;

  useEffect(() => {
    setUnreadCount(unreadCountFromServer);
  }, [unreadCountFromServer, setUnreadCount]);

  const markReadMutation = useApiMutation({
    endpoint: "/api/notifications/markNotificationRead",
    showSuccessMessage: false,
    showErrorMessage: false,
  });
  const markAllReadMutation = useApiMutation({
    endpoint: "/api/notifications/markAllNotificationsRead",
    showSuccessMessage: false,
    showErrorMessage: false,
  });

  const handleOpen = (e) => setAnchorEl(e.currentTarget);
  const handleClose = () => setAnchorEl(null);

  const handleClick = async (n) => {
    if (!n.IsRead) {
      await markReadMutation.mutateAsync({ Id: n.Id });
      refetch();
    }
    handleClose();
    onOpenEntity?.(n);
  };

  const handleMarkAll = async () => {
    await markAllReadMutation.mutateAsync({});
    resetUnread();
    refetch();
  };

  return (
    <>
      <div data-testid="notification-bell-wrapper">
        <Badge count={unreadCount} tone="error" pulse={unreadCount > 0}>
          <IconButton
            onClick={handleOpen}
            tooltip="Notifications"
            aria-label={`Notifications (${unreadCount} unread)`}
            data-testid="notification-bell"
          >
            <Bell size={18} />
          </IconButton>
        </Badge>
      </div>

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <div
          style={{
            width: 360,
            maxHeight: 480,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 16px",
              borderBottom: `1px solid ${p.border.default}`,
            }}
          >
            <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: p.text.primary }}>
              Notifications
            </div>
            {unreadCount > 0 && (
              <Button
                variant="text"
                size="sm"
                onClick={handleMarkAll}
                data-testid="mark-all-read"
              >
                Mark all read
              </Button>
            )}
          </div>

          {notifications.length === 0 ? (
            <EmptyState
              title="All caught up"
              description="No new notifications."
              size="sm"
            />
          ) : (
            <div style={{ overflowY: "auto", flex: 1 }}>
              {notifications.map((n) => (
                <button
                  key={n.Id}
                  type="button"
                  onClick={() => handleClick(n)}
                  data-testid={`notif-${n.Id}`}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "12px 16px",
                    border: "none",
                    background: n.IsRead ? "transparent" : p.primary.subtle,
                    borderBottom: `1px solid ${p.border.subtle}`,
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                    transition: "background-color 200ms cubic-bezier(0.4,0,0.2,1)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = p.surface.subtle;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = n.IsRead
                      ? "transparent"
                      : p.primary.subtle;
                  }}
                >
                  <Avatar name={n.ActorName ?? "?"} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: n.IsRead ? 500 : 700,
                        color: p.text.primary,
                        lineHeight: 1.3,
                      }}
                    >
                      {n.Title}
                    </div>
                    {n.Body && (
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: p.text.secondary,
                          marginTop: 2,
                          lineHeight: 1.4,
                        }}
                      >
                        {n.Body}
                      </div>
                    )}
                    <div
                      style={{
                        fontSize: 11,
                        color: p.text.tertiary,
                        marginTop: 4,
                      }}
                    >
                      {new Date(n.CreatedDate).toLocaleString()}
                    </div>
                  </div>
                  {!n.IsRead && (
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 9999,
                        backgroundColor: p.primary.main,
                        marginTop: 6,
                        flexShrink: 0,
                      }}
                    />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </Popover>
    </>
  );
}
