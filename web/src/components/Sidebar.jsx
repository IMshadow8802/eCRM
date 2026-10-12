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
import { buildDynamicMenu, isMenuPathActive } from "../utils/menuBuilder";
import { chrome } from "../styles/tokens";
import { rem } from "../utils/rem";

export const SIDEBAR_WIDTH_EXPANDED = 240;
export const SIDEBAR_WIDTH_RAIL = 68;

// Nav is fully DB-driven: buildDynamicMenu turns the user's tblMenu +
// tblGroupAccess rows (menuRights) into the tree, using each row's Route
// (seeded in 036) for nested SPA paths. Visibility/RBAC is the group's
// CanView grant — Sales/Support to all groups, Settings to admin groups.

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
  const { menuRights, setActiveMenuRights } = useAuthStore();

  const menus = buildDynamicMenu(menuRights || []);

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

  const isActive = (path) => isMenuPathActive(path, location);

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
        // Active was styling only; nothing told a screen reader which page it is on.
        aria-current={active ? "page" : undefined}
        onClick={handleClick}
        sx={{
          mx: asChild ? 0 : 1,
          my: 0.25,
          px: effectiveCollapsed ? 0 : 1.5,
          py: 1,
          minHeight: "calc(40rem / 15)",
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
        {showLabel && (
          <ListItemText
            primary={menu.title}
            title={menu.title}
            sx={{
              minWidth: 0,
              "& .MuiListItemText-primary": {
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              },
            }}
          />
        )}
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
        data-testid="sidebar-brand"
        sx={{
          px: effectiveCollapsed ? 1 : 2,
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          justifyContent: effectiveCollapsed ? "center" : "space-between",
          // Exactly the top bar's row 1 (chrome.row1): the divider under this
          // header continues the bar's hairline across the sidebar.
          boxSizing: "border-box",
          height: rem(chrome.row1),
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
          {effectiveCollapsed && !theme_isMobile ? (
            <Tooltip title="Expand sidebar" placement="right" arrow>
              <IconButton
                data-testid="sidebar-toggle"
                onClick={onToggleCollapsed}
                sx={{
                  width: "calc(40rem / 15)",
                  height: "calc(40rem / 15)",
                  borderRadius: 1.5,
                  background: (t) =>
                    t.palette.primary.main,
                  color: "common.white",
                  boxShadow: 2,
                  "&:hover": {
                    background: (t) =>
                      t.palette.primary.dark,
                  },
                }}
              >
                <ViewSidebarRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : (
            <Box
              sx={{
                width: "calc(40rem / 15)",
                height: "calc(40rem / 15)",
                borderRadius: 1.5,
                background: (t) =>
                  t.palette.primary.main,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: 2,
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
            minWidth: "calc(220rem / 15)",
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
              <ListItemIcon sx={{ minWidth: "calc(32rem / 15)" }}>
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
          slotProps={{
            root: { keepMounted: true },
            paper: {
              sx: {
                width: SIDEBAR_WIDTH_EXPANDED,
                border: "none",
                // theme.js puts `borderRadius: radii.lg` on every MuiPaper
                // root, which rounded the two corners that sit against the
                // screen edge — a drawer flush to the edge with a 16px notch
                // cut out of it reads as a rendering fault, not a style.
                borderRadius: 0,
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
            borderRadius: 0,
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
