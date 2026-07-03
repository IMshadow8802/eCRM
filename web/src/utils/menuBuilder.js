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
  TrendingUpOutlined,
  SupportAgentOutlined,
  ConfirmationNumberOutlined,
  AccountTreeOutlined,
  FilterAltOutlined,
  InsightsOutlined,
  DoneAllOutlined,
  TimerOutlined,
  CategoryOutlined,
  FlagOutlined,
  PhoneOutlined,
  TuneOutlined,
  ListAltOutlined,
} from "@mui/icons-material";

/**
 * Maps a menu title string to a MUI icon component.
 * Keyword matching, first-match-wins — so order matters: more specific
 * report/entity keywords come before the generic ones they overlap with
 * (e.g. "funnel" before "pipeline", "call" before "user").
 */
export function getMenuIcon(menuTitle) {
  const title = String(menuTitle || "").toLowerCase();
  if (title.includes("dashboard")) return DashboardOutlined;
  if (title.includes("task")) return TaskAltOutlined;
  if (title.includes("project")) return FolderOpenOutlined;
  if (title.includes("team")) return GroupsOutlined;
  if (title.includes("user group")) return AdminPanelSettingsOutlined;
  if (title.includes("kanban")) return ViewKanbanOutlined;
  // sales/support module — specific first
  if (title.includes("funnel")) return FilterAltOutlined;
  if (title.includes("conversion")) return InsightsOutlined;
  if (title.includes("resolution")) return DoneAllOutlined;
  if (title.includes("sla")) return TimerOutlined;
  if (title.includes("categor")) return CategoryOutlined;
  if (title.includes("priorit")) return FlagOutlined;
  if (title.includes("call")) return PhoneOutlined;
  if (title.includes("ticket")) return ConfirmationNumberOutlined;
  if (title.includes("support")) return SupportAgentOutlined;
  if (title.includes("sales")) return TrendingUpOutlined;
  if (title.includes("pipeline")) return AccountTreeOutlined;
  if (title.includes("field")) return TuneOutlined;
  if (title.includes("lookup")) return ListAltOutlined;
  if (title.includes("user")) return PersonOutlineOutlined;
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
// Menus that were retired when we moved kanban column management onto the
// Task board itself. Filter them out of the sidebar even if the backend
// tblMenu row is still present.
const HIDDEN_MENU_IDS = new Set([6]); // 6 = "Kanban Columns"

export function buildDynamicMenu(menuRights) {
  if (!menuRights || menuRights.length === 0) return [];

  const visible = menuRights.filter(
    (item) => !HIDDEN_MENU_IDS.has(item.menuid),
  );

  const parentMenus = visible.filter(
    (item) => item.parentid === 0 || item.parentid === item.menuid
  );
  const childMenus = visible.filter(
    (item) => item.parentid !== 0 && item.parentid !== item.menuid
  );

  // A menu row's `route` (from tblMenu.Route) wins when present so nested SPA
  // routes like /support/board work; legacy rows without a Route fall back to
  // the title-slug path.
  return parentMenus.map((parent) => {
    const children = childMenus.filter((c) => c.parentid === parent.menuid);
    return {
      title: parent.description,
      menuId: parent.menuid,
      icon: getMenuIcon(parent.description),
      permissions: parent.permissions,
      path: parent.route || menuPath(parent.description),
      submenus:
        children.length > 0
          ? children.map((child) => ({
              title: child.description,
              menuId: child.menuid,
              icon: getMenuIcon(child.description),
              permissions: child.permissions,
              path: child.route || menuPath(child.description),
            }))
          : null,
    };
  });
}
