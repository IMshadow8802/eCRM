import type { LucideIcon } from "lucide-react-native";

import { useAccess } from "../features/auth/useAccess";
import { moduleIcons, type UiModule } from "../theme";
import type { TabParamList } from "./RootNavigator";

export type TabName = keyof TabParamList;
/** A rail item: every tab, plus Inbox, which the rail carries and the bar does not. */
export type RailItem = TabName | "Inbox";

interface Can { tasks: boolean; complaints: boolean; leads: boolean }

/** What the bar can hold: Home + up to three modules + More. */
const MAX_TABS = 5;

/**
 * The bottom tabs for a role, in a fixed order: Today · Tasks · Complaints ·
 * Leads · Follow-ups · More. Follow-ups rides with Leads while the bar has
 * room for it; once Tasks and Complaints are both there it would make six,
 * so it moves under More.
 */
export function tabsFor(can: Can): TabName[] {
  const modules: TabName[] = [
    ...(can.tasks ? (["Tasks"] as const) : []),
    ...(can.complaints ? (["Complaints"] as const) : []),
    ...(can.leads ? (["Leads"] as const) : []),
  ];
  if (can.leads && modules.length + 3 <= MAX_TABS) modules.push("FollowUps");
  return ["Home", ...modules, "More"];
}

/**
 * The rail (T1–T4) has room for everything: Today · Tasks · Complaints ·
 * Leads · Follow-ups (with leads) · Inbox, then More at the foot (spec §2.2).
 * More is returned last; the Rail draws a spacer before it.
 */
export function railTabsFor(can: Can): RailItem[] {
  return [
    "Home",
    ...(can.tasks ? (["Tasks"] as const) : []),
    ...(can.complaints ? (["Complaints"] as const) : []),
    ...(can.leads ? (["Leads", "FollowUps"] as const) : []),
    "Inbox",
    "More",
  ];
}

/** Bar / rail label, icon and module tone per item (E: "Today", not "Home"). */
export const NAV_ITEMS: Record<RailItem, { label: string; module: UiModule; icon: LucideIcon }> = {
  Home: { label: "Today", module: "home", icon: moduleIcons.home.bar },
  Tasks: { label: "Tasks", module: "tasks", icon: moduleIcons.tasks.bar },
  Complaints: { label: "Complaints", module: "complaints", icon: moduleIcons.complaints.bar },
  Leads: { label: "Leads", module: "leads", icon: moduleIcons.leads.bar },
  FollowUps: { label: "Follow-ups", module: "followups", icon: moduleIcons.followups.bar },
  Inbox: { label: "Inbox", module: "inbox", icon: moduleIcons.inbox.bar },
  More: { label: "More", module: "more", icon: moduleIcons.more.bar },
};

/** The role's module VIEW grants — the same grant each list's endpoint checks. */
export function useCan(): Can {
  return {
    tasks: useAccess("tasks").view,
    complaints: useAccess("complaints").view,
    leads: useAccess("leads").view,
  };
}

/** The signed-in role's bottom tabs. Hiding is a courtesy; the server decides. */
export function useTabs(): TabName[] {
  return tabsFor(useCan());
}
