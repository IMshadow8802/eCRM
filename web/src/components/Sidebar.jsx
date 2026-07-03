import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Box,
  Divider,
  Drawer,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  MenuList,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import {
  BusinessRounded,
  MenuOpenRounded,
  ViewSidebarRounded,
  ExpandMoreRounded,
} from "@mui/icons-material";

import useAuthStore from "../stores/useAuthStore";
import { buildDynamicMenu, getMenuIcon } from "../utils/menuBuilder";

export const SIDEBAR_WIDTH_EXPANDED = 240;
export const SIDEBAR_WIDTH_RAIL = 68;

// The config-driven Sales module uses nested routes (/sales/*, /settings/*,
// /reports/*), which the flat title-slug tblMenu convention (menuPath) can't
// express — so its nav lives here as an explicit static tree rather than
// through buildDynamicMenu. Settings is company-admin-level (spec §2), gated
// on user.IsAdmin below. ponytail: unifying with tblMenu means retiring the
// legacy Master/Leads menu flow too — a separate product-level migration.
const SALES_MENU = {
  title: "Sales",
  menuId: "static-sales",
  icon: getMenuIcon("Sales"),
  permissions: null,
  path: "/sales",
  submenus: [
    { title: "Pipeline", menuId: "static-sales-pipeline", icon: getMenuIcon("Pipeline"), permissions: null, path: "/sales/pipeline" },
    { title: "Leads", menuId: "static-sales-leads", icon: getMenuIcon("Lead"), permissions: null, path: "/sales/leads" },
    { title: "Funnel Report", menuId: "static-report-funnel", icon: getMenuIcon("Report"), permissions: null, path: "/reports/pipeline-funnel" },
    { title: "Calls per User", menuId: "static-report-calls", icon: getMenuIcon("Report"), permissions: null, path: "/reports/calls-per-user" },
    { title: "Conversion by Source", menuId: "static-report-conversion", icon: getMenuIcon("Report"), permissions: null, path: "/reports/conversion-by-source" },
  ],
};

const SETTINGS_MENU = {
  title: "Settings",
  menuId: "static-settings",
  icon: getMenuIcon("Settings"),
  permissions: null,
  path: "/settings",
  submenus: [
    { title: "Custom Fields", menuId: "static-settings-fields", icon: getMenuIcon("Setting"), permissions: null, path: "/settings/custom-fields" },
    { title: "Pipelines", menuId: "static-settings-pipelines", icon: getMenuIcon("Setting"), permissions: null, path: "/settings/pipelines" },
    { title: "Lookups", menuId: "static-settings-lookups", icon: getMenuIcon("Setting"), permissions: null, path: "/settings/lookups" },
  ],
};

/**
 * Left-side primary navigation. Three behaviours:
 *   - Desktop / tablet (>= 768px): permanent drawer, width toggles between
 *     expanded (240px) and rail (68px icon-only) via the collapse button.
 *   - Mobile (< 768px): temporary overlay drawer, 240px wide, opened via
 *     the hamburger in TopNav.
 *
 * State is owned by RootLayout and passed in as props so TopNav's hamburger
 * and Sidebar's collapse button can coordinate.
 */
const Sidebar = ({ collapsed, onToggleCollapsed, mobileOpen, onMobileClose }) => {
  const theme_isMobile = useMediaQuery("(max-width:767.98px)");
  const navigate = useNavigate();
  const location = useLocation();
  const { menuRights, setActiveMenuRights, user } = useAuthStore();

  const staticMenus = [SALES_MENU, ...(user?.IsAdmin ? [SETTINGS_MENU] : [])];
  const menus = [...buildDynamicMenu(menuRights || []), ...staticMenus];

  const [expandedParents, setExpandedParents] = useState({});
  const [flyoutAnchor, setFlyoutAnchor] = useState(null);
  const [flyoutMenu, setFlyoutMenu] = useState(null);

  const toggleParent = (title) =>
    setExpandedParents((prev) => ({ ...prev, [title]: !prev[title] }));

  const openFlyout = (event, menu) => {
    setFlyoutAnchor(event.currentTarget);
    setFlyoutMenu(menu);
  };
  const closeFlyout = () => {
    setFlyoutAnchor(null);
    setFlyoutMenu(null);
  };

  const isActive = (path) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);

  const navigateTo = (menu, parentPermissions) => {
    setActiveMenuRights(menu.permissions || parentPermissions || null);
    navigate(menu.path);
    if (theme_isMobile && onMobileClose) onMobileClose();
  };

  // On mobile we always render a 240px panel; rail mode only applies to
  // the permanent desktop drawer.
  const effectiveCollapsed = theme_isMobile ? false : collapsed;
  const drawerWidth = effectiveCollapsed
    ? SIDEBAR_WIDTH_RAIL
    : SIDEBAR_WIDTH_EXPANDED;

  const renderMenuItem = (menu, { asChild = false } = {}) => {
    const Icon = menu.icon;
    const active = isActive(menu.path);
    const hasChildren = menu.submenus && menu.submenus.length > 0;
    const showLabel = !effectiveCollapsed || asChild;
    const isParentExpanded = !!expandedParents[menu.title];

    const handleClick = (event) => {
      if (hasChildren) {
        if (effectiveCollapsed) {
          openFlyout(event, menu);
        } else {
          toggleParent(menu.title);
        }
      } else {
        navigateTo(menu);
      }
    };

    const itemBody = (
      <MenuItem
        data-testid={`sidebar-${menu.title}`}
        onClick={handleClick}
        sx={{
          mx: asChild ? 0 : 1,
          my: 0.25,
          px: effectiveCollapsed ? 0 : 1.5,
          py: 1,
          minHeight: 40,
          justifyContent: effectiveCollapsed ? "center" : "flex-start",
          borderRadius: 1.5,
          fontSize: asChild ? "0.8667rem" : "0.9333rem",
          fontWeight: active ? 600 : 500,
          color: active ? "primary.main" : "text.primary",
          backgroundColor: active ? "action.selected" : "transparent",
          "&:hover": {
            backgroundColor: active ? "action.selected" : "action.hover",
          },
        }}
      >
        {Icon && (
          <ListItemIcon
            sx={{
              minWidth: effectiveCollapsed ? 0 : 36,
              justifyContent: "center",
              color: active ? "primary.main" : "text.secondary",
            }}
          >
            <Icon fontSize="small" />
          </ListItemIcon>
        )}
        {showLabel && <ListItemText primary={menu.title} />}
        {showLabel && hasChildren && (
          <ExpandMoreRounded
            fontSize="small"
            sx={{
              color: "text.secondary",
              transition: "transform 150ms",
              transform: isParentExpanded ? "rotate(180deg)" : "rotate(0)",
            }}
          />
        )}
      </MenuItem>
    );

    return (
      <Box key={menu.menuId}>
        {effectiveCollapsed ? (
          <Tooltip title={menu.title} placement="right" arrow>
            <Box>{itemBody}</Box>
          </Tooltip>
        ) : (
          itemBody
        )}
        {/* Inline children (expanded mode only) */}
        {!effectiveCollapsed && hasChildren && isParentExpanded && (
          <Box sx={{ pl: 3 }}>
            {menu.submenus.map((child) =>
              renderMenuItem(child, { asChild: true })
            )}
          </Box>
        )}
      </Box>
    );
  };

  const sidebarContent = (
    <Box
      sx={{
        width: drawerWidth,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        transition: (t) =>
          t.transitions.create("width", {
            easing: t.transitions.easing.sharp,
            duration: t.transitions.duration.shorter,
          }),
        overflowX: "hidden",
      }}
    >
      {/* Brand header + collapse toggle (top).
          Collapsed mode: the brand square doubles as the expand button. */}
      <Box
        sx={{
          px: effectiveCollapsed ? 1 : 2,
          py: effectiveCollapsed ? 1.25 : 2,
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          justifyContent: effectiveCollapsed ? "center" : "space-between",
          minHeight: 64,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
          {effectiveCollapsed && !theme_isMobile ? (
            <Tooltip title="Expand sidebar" placement="right" arrow>
              <IconButton
                data-testid="sidebar-toggle"
                onClick={onToggleCollapsed}
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: 1.5,
                  background: (t) =>
                    `linear-gradient(135deg, ${t.palette.primary.main} 0%, ${t.palette.primary.dark} 100%)`,
                  color: "common.white",
                  boxShadow: "0 4px 10px rgba(63, 79, 175, 0.35)",
                  "&:hover": {
                    background: (t) =>
                      `linear-gradient(135deg, ${t.palette.primary.light} 0%, ${t.palette.primary.main} 100%)`,
                  },
                }}
              >
                <ViewSidebarRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : (
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 1.5,
                background: (t) =>
                  `linear-gradient(135deg, ${t.palette.primary.main} 0%, ${t.palette.primary.dark} 100%)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: "0 4px 10px rgba(63, 79, 175, 0.35)",
              }}
            >
              <BusinessRounded sx={{ color: "common.white" }} fontSize="small" />
            </Box>
          )}
          {!effectiveCollapsed && (
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                color: "primary.main",
                letterSpacing: "-0.01em",
                background: (t) =>
                  `linear-gradient(135deg, ${t.palette.primary.main}, ${t.palette.primary.light})`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              CRM
            </Typography>
          )}
        </Box>
        {!theme_isMobile && !effectiveCollapsed && (
          <Tooltip title="Collapse sidebar" placement="bottom" arrow>
            <IconButton
              data-testid="sidebar-toggle"
              onClick={onToggleCollapsed}
              size="small"
              sx={{
                color: "text.secondary",
                borderRadius: 1.5,
                "&:hover": {
                  color: "primary.main",
                  backgroundColor: "action.selected",
                },
              }}
            >
              <MenuOpenRounded fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <Divider />

      {/* Scrollable menu list */}
      <Box sx={{ flex: 1, overflowY: "auto", overflowX: "hidden", py: 0.5 }}>
        <MenuList sx={{ py: 0.5 }} disablePadding>
          {menus.map((menu) => renderMenuItem(menu))}
        </MenuList>
      </Box>
    </Box>
  );

  // Flyout submenu for collapsed / rail mode
  const flyout = (
    <Menu
      anchorEl={flyoutAnchor}
      open={Boolean(flyoutAnchor)}
      onClose={closeFlyout}
      anchorOrigin={{ vertical: "top", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "left" }}
      slotProps={{
        paper: {
          sx: {
            ml: 0.5,
            minWidth: 220,
            boxShadow: 3,
            border: "1px solid",
            borderColor: "divider",
          },
        },
      }}
    >
      {flyoutMenu && (
        <MenuItem
          onClick={() => {
            navigateTo(flyoutMenu);
            closeFlyout();
          }}
          sx={{
            fontSize: "0.9333rem",
            fontWeight: 600,
            color: "text.primary",
            py: 1,
          }}
        >
          {flyoutMenu.title}
        </MenuItem>
      )}
      {flyoutMenu?.submenus?.map((child) => {
        const ChildIcon = child.icon;
        return (
          <MenuItem
            key={child.menuId}
            onClick={() => {
              navigateTo(child, flyoutMenu.permissions);
              closeFlyout();
            }}
            sx={{ fontSize: "0.8667rem", fontWeight: 500, py: 0.875 }}
          >
            {ChildIcon && (
              <ListItemIcon sx={{ minWidth: 32 }}>
                <ChildIcon fontSize="small" />
              </ListItemIcon>
            )}
            <ListItemText primary={child.title} />
          </MenuItem>
        );
      })}
    </Menu>
  );

  const sidebarBg = (t) =>
    t.palette.background.sidebar ||
    (t.palette.mode === "dark" ? "#101631" : "#eef1fa");

  if (theme_isMobile) {
    return (
      <>
        <Drawer
          variant="temporary"
          anchor="left"
          open={mobileOpen}
          onClose={onMobileClose}
          ModalProps={{ keepMounted: true }}
          slotProps={{
            paper: {
              sx: {
                width: SIDEBAR_WIDTH_EXPANDED,
                border: "none",
                backgroundColor: sidebarBg,
                backgroundImage: "none",
              },
            },
          }}
        >
          {sidebarContent}
        </Drawer>
        {flyout}
      </>
    );
  }

  return (
    <>
      <Drawer
        variant="permanent"
        open
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: drawerWidth,
            boxSizing: "border-box",
            borderRight: "1px solid",
            borderColor: "divider",
            backgroundColor: sidebarBg,
            backgroundImage: "none",
            transition: (t) =>
              t.transitions.create("width", {
                easing: t.transitions.easing.sharp,
                duration: t.transitions.duration.shorter,
              }),
            overflowX: "hidden",
          },
        }}
      >
        {sidebarContent}
      </Drawer>
      {flyout}
    </>
  );
};

export default Sidebar;
