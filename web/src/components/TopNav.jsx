import { useEffect, useState } from "react";
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom";
import { useSnackbar } from "notistack";
import {
  AppBar,
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
import { Sun, Moon, UserCog, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import useAuthStore from "../stores/useAuthStore";
import useThemeStore from "../stores/useThemeStore";
import { logoutUser } from "../api/platformQueries";
import UiAvatar from "./ui/Avatar";
import AccountModal from "./AccountModal";
import NotificationBell from "./Notifications/NotificationBell";
import { ConnectionStatus } from "../realtime/SocketProvider";
import { getUserName, getUserJobTitle } from "../utils/userShape";
import { useHeaderSlot } from "./ui/headerSlot";
import { buildDynamicMenu, menuTrail } from "../utils/menuBuilder";
import { chrome } from "../styles/tokens";
import { rem } from "../utils/rem";

/**
 * Thin top bar sitting above the main content area.
 *
 * On mobile (<768px) the hamburger opens the sidebar drawer (state lives
 * in RootLayout). On desktop/tablet the hamburger is hidden because the
 * sidebar is permanent.
 *
 * Responsibilities:
 *   - Mobile sidebar trigger
 *   - The page's header: PageHeader portals its title + actions into the
 *     slot here (headerSlot). Pages without one get a route-derived title.
 *   - Theme toggle
 *   - Profile dropdown with logout
 */
const TopNav = ({ onOpenMobileSidebar }) => {
  const isMobile = useMediaQuery("(max-width:767.98px)");
  const navigate = useNavigate();
  const location = useLocation();
  const { enqueueSnackbar } = useSnackbar();
  const { setSlot } = useHeaderSlot();

  const { user, logout, menuRights, companyName } = useAuthStore();
  const themeMode = useThemeStore((s) => s.mode);
  const toggleThemeMode = useThemeStore((s) => s.toggleMode);

  const [profileAnchor, setProfileAnchor] = useState(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

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

  // Where am I: the menu trail to this page. The parent is the breadcrumb;
  // the page's own title comes from its PageHeader (or the menu, failing that).
  const trail = menuTrail(buildDynamicMenu(menuRights || []), location);
  // Every page but the Dashboard starts its trail at the Dashboard (a link home).
  const onDashboard = location.pathname === "/" || location.pathname.startsWith("/dashboard");
  const crumbs = [...(onDashboard ? [] : [{ title: "Dashboard", path: "/dashboard", home: true }]), ...trail.slice(0, -1)];
  const pageTitle =
    trail.at(-1)?.title ??
    (location.pathname.split("/").filter(Boolean)[0] || "dashboard")
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

  // Flat at the top of the page; a soft shadow once anything has scrolled
  // under the bar. Capture phase, because <main> scrolls as well as the window.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = (e) => {
      const t = e.target;
      const top = t && t !== document && t.scrollTop != null ? t.scrollTop : window.scrollY;
      setScrolled(top > 0);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, []);

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      setProfileAnchor(null);
      try {
        await logoutUser();
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
      data-scrolled={scrolled ? "true" : "false"}
      sx={{
        // Attached, not floating: flush with the sidebar and the window top,
        // full width of the content column, a hairline underneath.
        top: 0,
        width: "100%",
        borderRadius: 0,
        backgroundColor: "background.paper",
        color: "text.primary",
        borderBottom: "1px solid",
        borderColor: "divider",
        boxShadow: (t) => (scrolled ? t.tokens.elevation[2] : "none"),
        transition: "box-shadow 200ms cubic-bezier(0.4,0,0.2,1)",
        zIndex: (t) => t.zIndex.appBar,
      }}
    >
      {/* Row 1 — app chrome: menu, company, status, notifications, theme, profile. */}
      <Toolbar
        disableGutters
        data-testid="topnav-row1"
        sx={{
          // A fixed height, shared with the sidebar's brand header (chrome.row1),
          // so the two dividers line up. `minHeight` on every breakpoint too:
          // MUI's Toolbar sets its own per breakpoint.
          height: rem(chrome.row1),
          minHeight: { xs: rem(chrome.row1), sm: rem(chrome.row1) },
          px: { xs: 1.5, md: 2.5 },
          gap: 1,
        }}
      >
        {isMobile && (
          <IconButton
            edge="start"
            data-testid="hamburger-button"
            onClick={onOpenMobileSidebar}
            aria-label="Open menu"
          >
            <MenuRounded />
          </IconButton>
        )}

        {companyName && (
          <Typography
            data-testid="app-context"
            noWrap
            sx={{ fontSize: "calc(13rem / 15)", fontWeight: 600, color: "text.secondary", minWidth: 0 }}
          >
            {companyName}
          </Typography>
        )}

        <Box sx={{ flex: 1 }} />

        <ConnectionStatus />

        <NotificationBell
          onOpenEntity={(n) => {
            // The notification SPs emit EntityType 'Workspace' capitalised but
            // 'task' lowercase (comments arrive as task too), so compare
            // case-insensitively.
            const entity = String(n?.EntityType ?? "").toLowerCase();
            if (entity === "task" && n?.EntityId) {
              navigate(`/tasks?taskId=${n.EntityId}`);
            } else if (entity === "ticket" && n?.EntityId) {
              // ticket_assigned / ticket_escalated (spec 2) — open the complaint.
              navigate(`/support/tickets/${n.EntityId}`);
            } else if (entity === "user" && n?.Type === "presence_not_signed_in") {
              navigate("/today?tab=team");
            } else if (entity === "workspace") {
              // Workspace invites had no handler at all — clicking the bell
              // item did nothing. WorkspaceSwitcher auto-prompts any pending
              // invite on mount, so landing on Tasks surfaces the
              // accept/decline modal.
              navigate("/tasks");
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
          <UiAvatar
            name={displayName}
            preset={currentUser?.Avatar}
            size="sm"
            online
          />
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
                width: "calc(300rem / 15)",
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
              <UiAvatar
                name={displayName}
                preset={currentUser?.Avatar}
                size="lg"
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
            <Box sx={{ pt: 1.5 }}>
              <Button
                fullWidth
                startIcon={<UserCog size={16} />}
                onClick={() => {
                  setProfileAnchor(null);
                  setAccountOpen(true);
                }}
                data-testid="open-account"
                sx={{ justifyContent: "flex-start", fontWeight: 600, color: "text.primary" }}
              >
                My Account
              </Button>
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

      {/* Row 2 — the page: breadcrumb, title (h1, from PageHeader via the
          header slot) and the page's actions. */}
      <Box
        data-testid="page-row"
        sx={{
          display: "flex",
          alignItems: "center",
          columnGap: 1,
          minHeight: rem(chrome.row2),
          px: { xs: 1.5, md: 2.5 },
          py: "calc(4rem / 15)",
          borderTop: "1px solid",
          borderColor: "divider",
          minWidth: 0,
        }}
      >
        {crumbs.length > 0 && (
          <Box
            component="nav"
            aria-label="Breadcrumb"
            data-testid="breadcrumb"
            sx={{ display: "inline-flex", alignItems: "center", gap: "calc(6rem / 15)", flexShrink: 0, fontSize: "calc(13rem / 15)", fontWeight: 500, color: "text.secondary", whiteSpace: "nowrap" }}
          >
            {crumbs.map((c) => (
              <Box component="span" key={c.menuId ?? c.title} sx={{ display: "inline-flex", alignItems: "center", gap: "calc(6rem / 15)" }}>
                {c.home ? (
                  <Box component={RouterLink} to={c.path} sx={{ color: "inherit", textDecoration: "none", "&:hover": { color: "primary.main", textDecoration: "underline" } }}>
                    {c.title}
                  </Box>
                ) : (
                  c.title
                )}
                <ChevronRight size={14} aria-hidden />
              </Box>
            ))}
          </Box>
        )}
        {/* The page's PageHeader portals in here. While it holds one, the
            menu-derived title after it is hidden by the sibling rule. */}
        <Box
          ref={setSlot}
          data-testid="header-slot"
          sx={{
            display: "flex",
            alignItems: "center",
            flex: 1,
            minWidth: 0,
            "&:empty": { display: "none" },
            "&:not(:empty) + [data-testid='page-title']": { display: "none" },
          }}
        />
        <Typography
          component="h1"
          data-testid="page-title"
          sx={{ m: 0, fontWeight: 600, fontSize: "calc(16rem / 15)", color: "text.primary", letterSpacing: "-0.01em" }}
        >
          {pageTitle}
        </Typography>
      </Box>

      {accountOpen && (
        <AccountModal open onClose={() => setAccountOpen(false)} />
      )}
    </AppBar>
  );
};

export default TopNav;
