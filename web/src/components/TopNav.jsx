import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSnackbar } from "notistack";
import {
  AppBar,
  Avatar,
  Box,
  Button,
  IconButton,
  Popover,
  Stack,
  Toolbar,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { MenuRounded, LogoutRounded } from "@mui/icons-material";
import { Sun, Moon } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import useAuthStore from "../stores/useAuthStore";
import useThemeStore from "../stores/useThemeStore";
import useApi from "../hooks/useApi";
import Profile from "../assets/profile.png";
import NotificationBell from "./Notifications/NotificationBell";
import { ConnectionStatus } from "../realtime/SocketProvider";
import { getUserId, getUserName, getUserJobTitle } from "../utils/userShape";

/**
 * Thin top bar sitting above the main content area.
 *
 * On mobile (<768px) the hamburger opens the sidebar drawer (state lives
 * in RootLayout). On desktop/tablet the hamburger is hidden because the
 * sidebar is permanent.
 *
 * Responsibilities:
 *   - Mobile sidebar trigger
 *   - Page-level brand (when sidebar is hidden on mobile)
 *   - Theme toggle
 *   - Profile dropdown with logout
 */
const TopNav = ({ onOpenMobileSidebar }) => {
  const isMobile = useMediaQuery("(max-width:767.98px)");
  const navigate = useNavigate();
  const location = useLocation();
  const { enqueueSnackbar } = useSnackbar();
  const apiClient = useApi();

  const { user, logout } = useAuthStore();
  const themeMode = useThemeStore((s) => s.mode);
  const toggleThemeMode = useThemeStore((s) => s.toggleMode);

  const [profileAnchor, setProfileAnchor] = useState(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const currentUser = (() => {
    try {
      const stored = JSON.parse(localStorage.getItem("userData"));
      return stored?.user || user;
    } catch {
      return user;
    }
  })();

  const displayName = getUserName(currentUser) || "User";
  const userRole = getUserJobTitle(currentUser) || "Employee";

  // Try to give the bar a page-title hint based on the current route
  // (sidebar carries the permanent branding, so this fills empty space).
  const pageTitle = (() => {
    const seg = location.pathname.split("/").filter(Boolean)[0] || "dashboard";
    return seg
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  })();

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      setProfileAnchor(null);
      try {
        await apiClient.post("/api/auth/logoutUser");
      } catch (apiError) {
        console.error("Logout API error:", apiError);
      }
      localStorage.removeItem("userData");
      logout();
      enqueueSnackbar("Logged out successfully", { variant: "success" });
      navigate("/login");
    } catch (error) {
      console.error("Logout error:", error);
      enqueueSnackbar("Error during logout", { variant: "error" });
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        top: { xs: 8, md: 12 },
        mx: { xs: 1, md: 1.5 },
        mt: { xs: 1, md: 1.5 },
        width: "auto",
        backgroundColor: "background.paper",
        color: "text.primary",
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.08)",
        zIndex: (t) => t.zIndex.appBar,
      }}
    >
      <Toolbar sx={{ minHeight: 56, px: { xs: 1.5, md: 2.5 }, borderRadius: 2 }}>
        {isMobile && (
          <IconButton
            edge="start"
            data-testid="hamburger-button"
            onClick={onOpenMobileSidebar}
            sx={{ mr: 1 }}
          >
            <MenuRounded />
          </IconButton>
        )}

        <Typography
          data-testid="page-title"
          sx={{
            fontWeight: 600,
            fontSize: "1rem",
            color: "text.primary",
            letterSpacing: "-0.01em",
          }}
        >
          {pageTitle}
        </Typography>

        <Box sx={{ flexGrow: 1 }} />

        <ConnectionStatus />

        <NotificationBell
          onOpenEntity={(n) => {
            if (n?.EntityType === "task" && n?.EntityId) {
              navigate(`/tasks?taskId=${n.EntityId}`);
            } else if (n?.EntityType === "comment" && n?.EntityId) {
              navigate(`/tasks?commentId=${n.EntityId}`);
            }
          }}
        />

        <IconButton
          onClick={toggleThemeMode}
          sx={{
            color: "text.secondary",
            mr: 0.5,
            borderRadius: (t) => `${t.radii?.md ?? 12}px`,
            transition: "transform 320ms cubic-bezier(0.4,0,0.2,1)",
            "&:hover": {
              backgroundColor: "action.hover",
              transform: "rotate(18deg)",
            },
          }}
          aria-label={
            themeMode === "dark"
              ? "Switch to light mode"
              : "Switch to dark mode"
          }
        >
          <AnimatePresence initial={false} mode="wait">
            {themeMode === "dark" ? (
              <motion.span
                key="sun"
                initial={{ opacity: 0, rotate: -90 }}
                animate={{ opacity: 1, rotate: 0 }}
                exit={{ opacity: 0, rotate: 90 }}
                transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
                style={{ display: "inline-flex" }}
              >
                <Sun size={18} />
              </motion.span>
            ) : (
              <motion.span
                key="moon"
                initial={{ opacity: 0, rotate: 90 }}
                animate={{ opacity: 1, rotate: 0 }}
                exit={{ opacity: 0, rotate: -90 }}
                transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
                style={{ display: "inline-flex" }}
              >
                <Moon size={18} />
              </motion.span>
            )}
          </AnimatePresence>
        </IconButton>

        <Box
          onClick={(e) => setProfileAnchor(e.currentTarget)}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.25,
            cursor: "pointer",
            px: 1,
            py: 0.5,
            borderRadius: 1.5,
            "&:hover": { backgroundColor: "action.hover" },
          }}
        >
          {!isMobile && (
            <Box sx={{ textAlign: "right" }}>
              <Typography
                sx={{
                  fontSize: "0.8667rem",
                  fontWeight: 600,
                  lineHeight: 1.1,
                }}
              >
                {displayName}
              </Typography>
              <Typography
                sx={{
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  color: "text.secondary",
                }}
              >
                {userRole}
              </Typography>
            </Box>
          )}
          <Box sx={{ position: "relative" }}>
            <Avatar
              src={Profile}
              alt={displayName}
              sx={{ width: 32, height: 32 }}
            />
            <Box
              sx={{
                position: "absolute",
                bottom: -2,
                right: -2,
                width: 10,
                height: 10,
                borderRadius: "50%",
                backgroundColor: "success.main",
                border: "2px solid",
                borderColor: "background.paper",
              }}
            />
          </Box>
        </Box>

        <Popover
          open={Boolean(profileAnchor)}
          anchorEl={profileAnchor}
          onClose={() => setProfileAnchor(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
          slotProps={{
            paper: {
              sx: {
                mt: 1,
                width: 300,
                boxShadow: 3,
                border: "1px solid",
                borderColor: "divider",
              },
            },
          }}
        >
          <Box sx={{ p: 2 }}>
            <Stack
              direction="row"
              spacing={1.5}
              sx={{
                alignItems: "center",
                pb: 1.5,
                borderBottom: "1px solid",
                borderColor: "divider"
              }}>
              <Avatar
                src={Profile}
                alt={displayName}
                sx={{ width: 48, height: 48 }}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    fontSize: "0.9333rem",
                    fontWeight: 600,
                    lineHeight: 1.2,
                  }}
                >
                  {displayName}
                </Typography>
                <Typography
                  sx={{
                    fontSize: "0.8rem",
                    fontWeight: 500,
                    color: "text.secondary",
                  }}
                >
                  {userRole}
                </Typography>
                <Typography
                  sx={{
                    fontSize: "0.75rem",
                    color: "text.secondary",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {currentUser?.email || currentUser?.Email || ""}
                </Typography>
              </Box>
            </Stack>
            <Stack spacing={0.75} sx={{ py: 1.5, fontSize: "0.8667rem" }}>
              <Stack direction="row" sx={{
                justifyContent: "space-between"
              }}>
                <Typography
                  sx={{ fontSize: "inherit", color: "text.secondary" }}
                >
                  User ID
                </Typography>
                <Typography sx={{ fontSize: "inherit", fontWeight: 600 }}>
                  #{getUserId(currentUser) ?? "N/A"}
                </Typography>
              </Stack>
              <Stack direction="row" sx={{
                justifyContent: "space-between"
              }}>
                <Typography
                  sx={{ fontSize: "inherit", color: "text.secondary" }}
                >
                  Role
                </Typography>
                <Typography sx={{ fontSize: "inherit", fontWeight: 600 }}>
                  {currentUser?.IsAdmin
                    ? "Administrator"
                    : "User"}
                </Typography>
              </Stack>
            </Stack>
            <Box sx={{ pt: 1.5, borderTop: "1px solid", borderColor: "divider" }}>
              <Button
                fullWidth
                color="error"
                startIcon={<LogoutRounded fontSize="small" />}
                onClick={handleLogout}
                disabled={isLoggingOut}
                sx={{ justifyContent: "flex-start", fontWeight: 600 }}
              >
                {isLoggingOut ? "Logging out…" : "Logout"}
              </Button>
            </Box>
          </Box>
        </Popover>
      </Toolbar>
    </AppBar>
  );
};

export default TopNav;
