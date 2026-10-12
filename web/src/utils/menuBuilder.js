import {
  DashboardOutlined,
  TaskAltOutlined,
  AssignmentIndOutlined,
  FolderOpenOutlined,
  GroupsOutlined,
  PersonOutlineOutlined,
  SettingsOutlined,
  AssessmentOutlined,
  EventAvailableOutlined,
  ViewKanbanOutlined,
  LabelOutlined,
  SourceOutlined,
  ContactPhoneOutlined,
  AdminPanelSettingsOutlined,
  LockPersonOutlined,
  CircleOutlined,
  TrendingUpOutlined,
  SupportAgentOutlined,
  ConfirmationNumberOutlined,
  AccountTreeOutlined,
  FilterAltOutlined,
  InsightsOutlined,
  DoneAllOutlined,
  CategoryOutlined,
  FlagOutlined,
  PhoneOutlined,
  TuneOutlined,
  ListAltOutlined,
  TimelineOutlined,
  TrendingDownOutlined,
  HourglassBottomOutlined,
  SwapHorizOutlined,
  Inventory2Outlined,
  EmojiEventsOutlined,
  PersonSearchOutlined,
  PeopleOutlined,
  RequestQuoteOutlined,
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
  if (title.includes("my work")) return AssignmentIndOutlined;
  if (title.includes("task")) return TaskAltOutlined;
  if (title.includes("project")) return FolderOpenOutlined;
  if (title.includes("team")) return GroupsOutlined;
  if (title.includes("permission") || title.includes("role"))
    return LockPersonOutlined;
  if (title.includes("admin")) return AdminPanelSettingsOutlined;
  if (title.includes("user group")) return AdminPanelSettingsOutlined;
  if (title.includes("kanban")) return ViewKanbanOutlined;
  // sales/support module — specific first
  // spec 2: the Customers row under Support (086 adds tblMenu row + grants).
  if (title.includes("customer")) return PeopleOutlined;
  // 091 §10: the Quotations row under Sales. "quotation" is checked before
  // "lead" so a menu row titled "Lead Quotations" wouldn't fall through.
  if (title.includes("quotation")) return RequestQuoteOutlined;
  if (title.includes("funnel")) return FilterAltOutlined;
  // spec 4a report pages — each needs its own keyword or it falls through to
  // the circle, which is what every unmapped menu row looked like.
  if (title.includes("activity")) return TimelineOutlined;
  if (title.includes("lost")) return TrendingDownOutlined;
  if (title.includes("aging")) return HourglassBottomOutlined;
  if (title.includes("transfer")) return SwapHorizOutlined;
  if (title.includes("leaderboard")) return EmojiEventsOutlined;
  if (title.includes("product")) return Inventory2Outlined;
  if (title.includes("conversion")) return InsightsOutlined;
  if (title.includes("resolution")) return DoneAllOutlined;
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
  if (title.includes("lead")) return PersonSearchOutlined;
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

// tblMenu.SortOrder (110) orders siblings; a row without one sorts after the
// ranked rows, by id — which is also the whole order before 110 is applied.
const rank = (item) => (typeof item.sortOrder === "number" ? item.sortOrder : Infinity);
const bySortOrder = (a, b) => rank(a) - rank(b) || a.menuid - b.menuid;

export function buildDynamicMenu(menuRights) {
  if (!menuRights || menuRights.length === 0) return [];

  const visible = menuRights
    .filter((item) => !HIDDEN_MENU_IDS.has(item.menuid))
    .sort(bySortOrder);

  const parentMenus = visible.filter(
    (item) => item.parentid === 0 || item.parentid === item.menuid
  );
  const childMenus = visible.filter(
    (item) => item.parentid !== 0 && item.parentid !== item.menuid
  );

  // A menu row's `route` (from tblMenu.Route) wins when present so nested SPA
  // routes like /support/customers work; legacy rows without a Route fall back to
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

/**
 * Does a menu path match the current location? A Route may carry a query
 * string (tblMenu row 22 is /reports/funnel?groupBy=source), so the path part
 * is compared (exact or as a prefix segment), then the row's params must be
 * present in the URL. Shared by the sidebar highlight and the breadcrumb.
 */
export function isMenuPathActive(path, location) {
  const [pathname, search] = String(path).split("?");
  if (location.pathname !== pathname && !location.pathname.startsWith(`${pathname}/`)) return false;
  if (!search) return true;
  const here = new URLSearchParams(location.search);
  return [...new URLSearchParams(search)].every(([k, v]) => here.get(k) === v);
}

/**
 * The menu trail to the current page: [parent, child] for a submenu page,
 * [item] for a top-level one, [] when no menu row matches.
 */
export function menuTrail(menus, location) {
  for (const m of menus) {
    const child = (m.submenus ?? []).find((c) => isMenuPathActive(c.path, location));
    if (child) return [m, child];
    if (isMenuPathActive(m.path, location)) return [m];
  }
  return [];
}
