// Plain-language help for the presence + TAT screens: the "?" guides (EN/हिंदी)
// and the hover/focus tooltips on terms an office worker will not know.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import Today from "./Today";
import DayMarkDialog from "./DayMarkDialog";
import SessionsDialog from "./SessionsDialog";
import TatPanel from "../Task/Components/TaskDetail/TatPanel";
import WorkCalendar from "../Settings/WorkCalendar";
import TatReport from "../Reports/TatReport";
import AttendanceReport from "../Reports/AttendanceReport";
import TatChip from "../../components/Kanban/TatChip";
import useAuthStore from "../../stores/useAuthStore";
import { HELP_GUIDES } from "../../data/helpGuides";
import { server } from "../../test/mocks/server";
import { tatHandlers } from "../../test/tatMocks";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";
import renderWithProviders from "../../test/renderWithProviders";

vi.mock("../../components/ui/DateField", () => import("../../test/DateFieldStub"));

const ok = (data = {}) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });

const team = [
  { UserId: 5, FullName: "Asha", status: { code: "not_signed_in_yet", label: "Not signed in yet", late: "Late by 12 min" }, FirstSignInAt: null, Open: 3, AtRisk: 1, Over: 1, ReasonPending: 2 },
];

function signIn(admin) {
  useAuthStore.setState({
    isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://x/CRM",
    access: { isAdmin: admin, modules: { settings: { view: true, edit: true } } },
  });
}

// Open the "?" popover, check English, switch to Hindi, check Hindi.
async function guideWorks(user, en, hi) {
  await user.click(await screen.findByTestId("help-guide-button"));
  const pop = await screen.findByTestId("help-guide-popover");
  expect(pop).toHaveTextContent(en);
  await user.click(screen.getByTestId("help-lang-hi"));
  expect(pop).toHaveTextContent(hi);
}

const tipOf = async (user, el, text) => {
  await user.hover(el);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(text);
  await user.unhover(el);
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
};

describe("help guides content", () => {
  it.each(["today", "taskTat", "workCalendar", "tatReport", "attendanceReport"])("%s is fully bilingual", (key) => {
    const g = HELP_GUIDES[key];
    expect(g.titleEn && g.titleHi).toBeTruthy();
    for (const sec of g.sections) {
      expect(sec.headingEn && sec.headingHi).toBeTruthy();
      for (const st of sec.steps) {
        expect(st.en?.length).toBeGreaterThan(5);
        expect(st.hi).toMatch(/[ऀ-ॿ]/);
      }
    }
  });
  it("tasks guide has the deadline chip section", () => {
    expect(HELP_GUIDES.tasks.sections.some((s) => s.headingEn === "Deadline chip on cards")).toBe(true);
  });
});

describe("Today", () => {
  beforeEach(() => {
    signIn(true);
    server.use(...tatHandlers());
    server.use(
      http.post("*/api/tat/fetchToday", () => ok({ presence: { FirstSignInAt: null, status: { code: "online", label: "Online" } }, clocks: [], reasonPending: [] })),
      http.post("*/api/tat/fetchTeamToday", () => ok({ team })),
      http.post("*/api/presence/fetchSessions", () => ok({ sessions: [] })),
    );
  });

  it("has the guide in EN and हिंदी", async () => {
    renderWithProviders(<Today />, { route: "/today" });
    await guideWorks(userEvent.setup(), /Not signed in yet.*Leave \/ on duty.*Sign-ins/s, /साइन-इन/);
  });

  it("explains Leave / on duty, Sign-ins, headers and statuses on hover", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Today />, { route: "/today?tab=team" });
    await screen.findByTestId("team-table");
    await tipOf(user, screen.getByTestId("mark-day-5"), /leave.*on duty/i);
    await tipOf(user, screen.getByTestId("sessions-5"), /sign them out everywhere/);
    await tipOf(user, screen.getByText("Tasks running"), /deadline running/);
    await tipOf(user, screen.getByText("Close to deadline"), /most of the allowed time/);
    await tipOf(user, screen.getByText("Waiting for reason"), /not yet said why/);
    await tipOf(user, screen.getByText("Not signed in yet"), /count as late after.'? minutes are still running/);
    await tipOf(user, screen.getByText("Late by 12 min"), /after the .count as late after. minutes/);
  });

  it("a header tooltip opens on keyboard focus too", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Today />, { route: "/today?tab=team" });
    await screen.findByTestId("team-table");
    await user.tab(); // walk until the "Status" header is focused
    // MRT makes the header cell itself a tab stop; the hint is the span inside it.
    const onHint = () => document.activeElement?.tagName === "SPAN" && document.activeElement.textContent === "Status";
    for (let i = 0; i < 40 && !onHint(); i += 1) await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/at work today/);
  });

  it("explains the Leave / on duty options and Sign out everywhere", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<DayMarkDialog open person={{ UserId: 5, FullName: "Asha" }} date="2026-10-08" onClose={() => {}} />, { route: "/today" });
    await tipOf(user, screen.getByTestId("day-mark-kind"), /working away from the office.*present/);
    await tipOf(user, screen.getByTestId("day-mark-part"), /first or second half/);
    unmount();
    renderWithProviders(<SessionsDialog open person={{ UserId: 5, FullName: "Asha" }} onClose={() => {}} />, { route: "/today" });
    await tipOf(user, await screen.findByTestId("sessions-end-all"), /lost or shared|lost/);
  });
});

describe("Task TAT", () => {
  const clock = { Id: 1, UserId: 7, FullName: "Me", AssignedAt: "2026-10-08T04:00:00Z", DueAt: "2026-10-08T12:00:00Z", ClosedAt: null, AcknowledgedAt: null, BreachedAt: null, CanJudge: false };
  it("explains Accept task, Put on hold, the pill and timeline words", async () => {
    server.use(...tatHandlers({ tat: { clocks: [clock], holds: [], events: [] } }));
    const user = userEvent.setup();
    renderWithProviders(<TatPanel task={{ Id: 501 }} canReassign currentUserId={7} />, { router: false });
    await tipOf(user, await screen.findByTestId("tat-ack"), /seen this task/);
    await tipOf(user, screen.getByTestId("tat-hold"), /Pause your timer/);
    await tipOf(user, screen.getByTestId("tat-hold-all"), /everyone's timers/);
    await tipOf(user, screen.getByText("Running"), /ticking during working hours/);
    await tipOf(user, screen.getByText("Accepted"), /confirmed they have seen it/);
    // the button keeps its own name (tooltip describes, never renames)
    expect(screen.getByRole("button", { name: "Accept task" })).toBeInTheDocument();
  });

  it("TatPanel has the TAT guide, opens in EN and हिंदी", async () => {
    server.use(...tatHandlers({ tat: { clocks: [clock], holds: [], events: [] } }));
    renderWithProviders(<TatPanel task={{ Id: 501 }} canReassign currentUserId={7} />, { router: false });
    await screen.findByTestId("tat-ack");
    await guideWorks(userEvent.setup(), /80% of the allowed time/, /80%/);
  });

  it("TatChip says it in a full sentence", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TatChip task={{ Id: 3, TatHeldSince: "2026-10-08 10:00:00", TatHoldReason: "waiting on client" }} />, { router: false });
    const chip = screen.getByTestId("card-tat-3");
    expect(chip).toHaveAttribute("aria-label", expect.stringMatching(/The timer is paused/));
    expect(chip.parentElement).not.toHaveAttribute("tabindex");
    await tipOf(user, chip, /On hold: waiting on client\. The timer is paused/);
  });
});

describe("Work calendar", () => {
  it("has the guide and explains Rules and shift headers", async () => {
    signIn(true);
    server.use(
      http.post("*/api/work/fetchWorkSettings", () => ok({
        settings: { LateGraceMin: 10, SessionBufferMin: 30, WarnPct: 80, NotifyNotSignedIn: 1, GoLiveDate: null },
        calendars: [{ Id: 1, Name: "General", IsDefault: 1, UserCount: 1, DaysJson: [] }], holidays: [], tatPolicy: [],
      })),
      http.post("*/api/users/fetchBranches", () => ok({ branches: [] })),
    );
    const user = userEvent.setup();
    renderWithProviders(<WorkCalendar />, { route: "/settings/work-calendar" });
    await guideWorks(user, /night shift belongs to the day it starts/, /रात की शिफ़्ट/);
    await user.keyboard("{Escape}");
    await user.click(await screen.findByRole("button", { name: "Edit General" }));
    await tipOf(user, await screen.findByText("Break start", { selector: "span" }), /Break time does not count/);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("tab", { name: "Rules" }));
    expect(await screen.findByText(/without being marked late/)).toBeInTheDocument();
    await tipOf(user, screen.getByText("Tell managers when someone has not signed in"), /manager gets a notice/);
  });
});

describe("Team reports", () => {
  it("TAT: guide and KPI/column tooltips", async () => {
    signIn(true);
    mockReportEndpoints("/api/reports/tat", reportData({
      kpis: { Clocks: 10, Closed: 8, OnTimePct: 80, RanOver: 2, RanOverNotExcused: 1, MedianWorkMin: 190, P90WorkMin: 45 },
      rows: [{ GroupKey: 5, GroupLabel: "Asha", Clocks: 10 }],
    }));
    const user = userEvent.setup();
    renderWithProviders(<TatReport />, { route: "/reports/tat" });
    await screen.findByTestId("tat-table");
    await tipOf(user, within_kpi("On time (of finished)"), /share that was done before the deadline/);
    await tipOf(user, screen.getAllByText("Delay accepted")[0], /accepted the delay/);
    await guideWorks(user, /Slowest 10% took/, /Slowest 10%/);
  });

  it("Attendance: guide and tooltips", async () => {
    signIn(true);
    mockReportEndpoints("/api/reports/attendance", reportData({
      kpis: { People: 4, WorkingDays: 80, PresentDays: 70, LateDays: 6, MedianLateMin: 75, NotSignedInDays: 4 },
      rows: [{ GroupKey: 5, GroupLabel: "Asha", WorkingDays: 20 }],
    }));
    const user = userEvent.setup();
    renderWithProviders(<AttendanceReport />, { route: "/reports/attendance" });
    await screen.findByTestId("attendance-table");
    await tipOf(user, within_kpi("Present"), /On duty count as present/);
    await guideWorks(user, /Working days/, /उपस्थित/);
  });
});

// KPI titles also appear as table headers; the KPI strip is the first match.
function within_kpi(label) {
  return screen.getAllByText(label)[0];
}
