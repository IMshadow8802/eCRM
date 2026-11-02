import { NAV_ITEMS, railTabsFor, tabsFor } from "./tabs";

const can = (tasks: boolean, complaints: boolean, leads: boolean) => ({ tasks, complaints, leads });

it.each([
  ["all", can(true, true, true), ["Home", "Tasks", "Complaints", "Leads", "More"]],
  ["complaints-only", can(false, true, false), ["Home", "Complaints", "More"]],
  ["leads-only", can(false, false, true), ["Home", "Leads", "FollowUps", "More"]],
  ["tasks-only", can(true, false, false), ["Home", "Tasks", "More"]],
] as const)("bar for %s", (_, c, tabs) => expect(tabsFor(c)).toEqual(tabs));

it.each([
  ["all", can(true, true, true), ["Home", "Tasks", "Complaints", "Leads", "FollowUps", "Inbox", "More"]],
  ["complaints-only", can(false, true, false), ["Home", "Complaints", "Inbox", "More"]],
  ["leads-only", can(false, false, true), ["Home", "Leads", "FollowUps", "Inbox", "More"]],
  ["tasks-only", can(true, false, false), ["Home", "Tasks", "Inbox", "More"]],
  ["nothing", can(false, false, false), ["Home", "Inbox", "More"]],
] as const)("rail for %s: Follow-ups always with leads, Inbox always, More last", (_, c, items) =>
  expect(railTabsFor(c)).toEqual(items));

it("E's labels and module tones", () => {
  expect(NAV_ITEMS.Home).toMatchObject({ label: "Today", module: "home" });
  expect(NAV_ITEMS.FollowUps).toMatchObject({ label: "Follow-ups", module: "followups" });
  expect(NAV_ITEMS.More).toMatchObject({ label: "More", module: "more" });
});
