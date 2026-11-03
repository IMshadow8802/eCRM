import {
  Archive, BadgeCheck, Bell, CalendarCheck, CalendarClock, Check, ChevronsUp, Circle, CircleCheck, CircleDot,
  CirclePause, CirclePlay, CircleX, Clock, Ellipsis, FileText, Flag, Headset, House, Inbox, LayoutDashboard,
  ListChecks, Lock, MapPin, MessageSquare, OctagonAlert, Pencil, Phone, PhoneCall, Plus, Sparkles,
  SquareCheckBig, Target, Timer, Trophy, UserCheck, UserPlus, Users,
} from "lucide-react-native";

import {
  activityBadge, complaintBadge, escalatedMark, followUpBadge, leadBadge, moduleIcons, notificationBadge,
  priorityChip, taskStage, taskStageBadge, tatEventBadge, workspaceBadge,
} from "./statusBadges";

describe("E §1.6 status → badge", () => {
  it.each([
    ["open", "sky", CircleDot, "sky"],
    ["onhold", "butter", CirclePause, "butter"],
    ["resolved", "green", CircleCheck, "green"],
    ["closed", "slate", Archive, "slate"],
    ["rejected", "red", CircleX, "red"],
    // A code the app does not know is still somebody's open job.
    ["reviewing", "sky", CircleDot, "sky"],
    [null, "sky", CircleDot, "sky"],
  ])("complaint %s", (code, tone, icon, chip) => expect(complaintBadge(code)).toEqual({ tone, icon, chip }));

  it("escalated marks with chevrons-up and a lilac pill", () =>
    expect(escalatedMark).toEqual({ icon: ChevronsUp, chip: "lilac" }));

  it.each([
    ["open", 0, "sky", Sparkles],
    ["open", 1, "teal", Phone],
    ["open", 2, "butter", FileText],
    ["open", 7, "butter", FileText],
    ["open", -1, "sky", Sparkles],
    ["qualified", 0, "lilac", BadgeCheck],
    ["converted", 0, "green", Trophy],
    ["lost", 0, "red", CircleX],
    ["junk", 0, "slate", CircleX],
    // Unknown codes fall back like an open status at that rank.
    ["mystery", 1, "teal", Phone],
    [undefined, undefined, "sky", Sparkles],
  ] as const)("lead %s at open rank %s", (code, rank, tone, icon) =>
    expect(leadBadge(code, rank)).toEqual({ tone, icon, chip: tone }));

  it.each([
    [{ IsCompleted: true, ChecklistDone: 0 }, "done", "green", CircleCheck, "Done"],
    [{ IsCompleted: false, ChecklistDone: 2 }, "inProgress", "teal", CirclePlay, "In progress"],
    [{ IsCompleted: false, ChecklistDone: 0 }, "todo", "slate", Circle, "To do"],
    [{ IsCompleted: false, ChecklistDone: null }, "todo", "slate", Circle, "To do"],
    [{ IsCompleted: false }, "todo", "slate", Circle, "To do"],
  ] as const)("task stage of %o", (task, stage, tone, icon, label) => {
    expect(taskStage(task)).toBe(stage);
    expect(taskStageBadge(stage)).toEqual({ tone, icon, chip: tone, label });
  });

  it.each([
    ["urgent", "red"], ["High", "red"], ["medium", "butter"], ["low", "slate"], [null, "slate"], ["odd", "slate"],
  ])("priority %s is a %s flag", (p, tone) => expect(priorityChip(p)).toEqual({ tone, icon: Flag }));

  it.each([
    ["personal", "slate", Lock], ["shared", "teal", Users], ["project", "lilac", LayoutDashboard], [null, "teal", Users],
  ] as const)("workspace %s", (type, tone, icon) => expect(workspaceBadge(type)).toEqual({ tone, icon, chip: tone }));

  it.each([
    ["call", "open", "sky", Phone],
    ["Visit", "open", "teal", MapPin],
    ["meeting", "open", "lilac", Users],
    ["other", "open", "slate", CalendarClock],
    [null, undefined, "slate", CalendarClock],
    ["call", "done", "green", Check],
    ["call", "overdue", "red", Phone],
    ["visit", "overdue", "red", MapPin],
    // 119: cancelled when the lead was won/lost — its type, in slate.
    ["visit", "cancelled", "slate", MapPin],
    ["other", "cancelled", "slate", CalendarClock],
  ] as const)("follow-up %s (%s)", (type, state, tone, icon) => expect(followUpBadge(type, state)).toEqual({ tone, icon }));

  it.each([
    ["ticket_escalated", "lilac", ChevronsUp],
    ["tat_breach", "red", OctagonAlert],
    ["followup_missed", "red", OctagonAlert],
    ["tat_warn", "butter", Timer],
    ["task_due_soon", "butter", Timer],
    ["task_assigned", "indigo", UserCheck],
    ["ticket_assigned", "indigo", UserCheck],
    ["comment_added", "teal", MessageSquare],
    ["reply", "teal", MessageSquare],
    ["workspace_invite", "indigo", UserPlus],
    ["member_added", "indigo", UserPlus],
    ["task_completed", "slate", Bell],
    [null, "slate", Bell],
  ] as const)("notification %s", (type, tone, icon) => expect(notificationBadge(type)).toEqual({ tone, icon }));

  it.each([
    ["escalated", "lilac", ChevronsUp], ["call", "sky", PhoneCall], ["assigned", "teal", UserCheck],
    ["created", "slate", Plus], ["Resolved", "green", CircleCheck], ["onhold", "butter", CirclePause],
    ["status", "butter", CirclePause], ["reopened", "sky", CircleDot], ["closed", "slate", Archive],
    ["rejected", "red", CircleX], ["updated", "slate", Pencil], [null, "slate", Pencil],
  ] as const)("complaint activity %s", (type, tone, icon) => expect(activityBadge(type)).toEqual({ tone, icon }));

  it.each([
    ["started", "sky", CirclePlay], ["held", "butter", CirclePause], ["due", "slate", Clock], ["breached", "red", OctagonAlert],
  ] as const)("TAT %s", (event, tone, icon) => expect(tatEventBadge(event)).toEqual({ tone, icon }));

  it("module icons: bar vs tile", () => {
    expect(moduleIcons).toEqual({
      home: { bar: House, tile: House },
      inbox: { bar: Inbox, tile: Inbox },
      tasks: { bar: SquareCheckBig, tile: ListChecks },
      complaints: { bar: Headset, tile: Headset },
      leads: { bar: Target, tile: Target },
      followups: { bar: CalendarClock, tile: CalendarCheck },
      more: { bar: Ellipsis, tile: Ellipsis },
    });
  });
});
