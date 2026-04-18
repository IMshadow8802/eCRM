import {
  DashboardOutlined,
  TaskAltOutlined,
  FolderOpenOutlined,
  GroupsOutlined,
  PersonOutlineOutlined,
  SettingsOutlined,
  AssessmentOutlined,
  LeaderboardOutlined,
  EventAvailableOutlined,
  ViewKanbanOutlined,
  LabelOutlined,
  SourceOutlined,
  ContactPhoneOutlined,
  AdminPanelSettingsOutlined,
  CircleOutlined,
} from "@mui/icons-material";

/**
 * Maps a menu title string to a MUI icon component.
 * Uses keyword matching so menus coming from the backend (which may
 * phrase titles differently) still resolve to a sensible icon.
 */
export function getMenuIcon(menuTitle) {
  const title = String(menuTitle || "").toLowerCase();
  if (title.includes("dashboard")) return DashboardOutlined;
  if (title.includes("task")) return TaskAltOutlined;
  if (title.includes("project")) return FolderOpenOutlined;
  if (title.includes("team")) return GroupsOutlined;
  if (title.includes("user group")) return AdminPanelSettingsOutlined;
  if (title.includes("user")) return PersonOutlineOutlined;
  if (title.includes("kanban")) return ViewKanbanOutlined;
  if (title.includes("status")) return LabelOutlined;
  if (title.includes("source")) return SourceOutlined;
  if (title.includes("lead")) return LeaderboardOutlined;
  if (title.includes("follow")) return EventAvailableOutlined;
  if (title.includes("contact")) return ContactPhoneOutlined;
  if (title.includes("report")) return AssessmentOutlined;
  if (title.includes("master")) return SettingsOutlined;
  if (title.includes("setting")) return SettingsOutlined;
  return CircleOutlined;
}

/**
 * Convert a menu title into a URL-safe route slug.
 * "Lead Source" → "/lead_source"
 */
export function menuPath(title) {
  return `/${String(title || "").replace(/\s+/g, "_").toLowerCase()}`;
}

/**
 * Build the navigation tree from the user's menuRights.
 *
 * menuRights shape (from backend):
 *   [{ menuid, description, parentid, permissions, ... }]
 *
 * Parents: parentid === 0 OR parentid === menuid (self-referencing)
 * Children: everything else, grouped by parent menuid.
 *
 * Returns: [{ title, menuId, icon, permissions, submenus: [...] | null }]
 */
export function buildDynamicMenu(menuRights) {
  if (!menuRights || menuRights.length === 0) return [];

  const parentMenus = menuRights.filter(
    (item) => item.parentid === 0 || item.parentid === item.menuid
  );
  const childMenus = menuRights.filter(
    (item) => item.parentid !== 0 && item.parentid !== item.menuid
  );

  return parentMenus.map((parent) => {
    const children = childMenus.filter((c) => c.parentid === parent.menuid);
    return {
      title: parent.description,
      menuId: parent.menuid,
      icon: getMenuIcon(parent.description),
      permissions: parent.permissions,
      path: menuPath(parent.description),
      submenus:
        children.length > 0
          ? children.map((child) => ({
              title: child.description,
              menuId: child.menuid,
              icon: getMenuIcon(child.description),
              permissions: child.permissions,
              path: menuPath(child.description),
            }))
          : null,
    };
  });
}
