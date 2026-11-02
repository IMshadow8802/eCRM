import { useAccess } from "../features/auth/useAccess";
import type { TabParamList } from "./RootNavigator";

export type TabName = keyof TabParamList;

/** What the bar can hold: Home + up to three modules + More. */
const MAX_TABS = 5;

/**
 * The bottom tabs for a role, in a fixed order: Home · Tasks · Complaints ·
 * Leads · Follow-ups · More (HubSpot / Zoho / Freshdesk mobile: the modules
 * you use, one tap each, plus Home and More — no drawer).
 *
 * Follow-ups rides with Leads while the bar has room for it; once Tasks and
 * Complaints are both there it would make six, so it moves under More.
 */
export function tabsFor(can: { tasks: boolean; complaints: boolean; leads: boolean }): TabName[] {
  const modules: TabName[] = [
    ...(can.tasks ? (["Tasks"] as const) : []),
    ...(can.complaints ? (["Complaints"] as const) : []),
    ...(can.leads ? (["Leads"] as const) : []),
  ];
  if (can.leads && modules.length + 3 <= MAX_TABS) modules.push("FollowUps");
  return ["Home", ...modules, "More"];
}

/**
 * The signed-in role's tabs. Built from module VIEW grants — the same grant
 * each list's endpoint checks, so a tab never opens onto a 403. Hiding is a
 * courtesy; the server decides.
 */
export function useTabs(): TabName[] {
  const tasks = useAccess("tasks").view;
  const complaints = useAccess("complaints").view;
  const leads = useAccess("leads").view;
  return tabsFor({ tasks, complaints, leads });
}
