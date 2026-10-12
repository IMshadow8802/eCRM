// Plain-language help for the presence + TAT screens: the "?" guides (EN/हिंदी)
// and the hover/focus tooltips on terms an office worker will not know.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
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
import { mockReportEndpoints } from "../../test/reportMocks";
import renderWithProviders from "../../test/renderWithProviders";

vi.mock("../../components/ui/DateField", () => import("../../test/DateFieldStub"));

const ok = (data = {}) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });

const zero = { given: 0, done: 0, open: 0, working: 0, overdue: 0, atRisk: 0, reasonOwed: 0, toRule: 0 };
const team = [
  { UserId: 5, FullName: "Asha", status: { code: "not_signed_in_yet", label: "Not signed in yet" }, FirstSignInAt: null, counts: { ...zero, open: 3, atRisk: 1, overdue: 1 } },
  { UserId: 6, FullName: "Ravi", status: { code: "online", label: "Online", late: "Late by 12 min" }, LateMinutes: 12, FirstSignInAt: "2026-10-11 09:42:00", counts: zero },
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
      http.post("*/api/today/teamSize", () => ok({ count: team.length })),
      http.post("*/api/today/mine", () => ok({ day: { key: "2026-10-11", live: true }, me: { UserId: 1, FullName: "Me", status: { code: "online", label: "Online" }, counts: zero, tasks: [] } })),
      http.post("*/api/today/team", () => ok({ day: { key: "2026-10-11", live: true }, people: team })),
      http.post("*/api/users/fetchBranches", () => ok({ branches: [] })),
      http.post("*/api/presence/fetchSessions", () => ok({ sessions: [] })),
    );
  });

  it("has the guide in EN and हिंदी", async () => {
    renderWithProviders(<Today />, { route: "/today" });
    await guideWorks(userEvent.setup(), /Not signed in yet.*Leave \/ on duty.*Sign-ins/s, /साइन-इन/);
  });

  it("explains Leave / on duty, Sign-ins, tiles and statuses on hover", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Today />, { route: "/today?tab=team" });
    await screen.findByTestId("person-card-5");
    await tipOf(user, screen.getByTestId("mark-day-5"), /leave.*on duty/i);
    await tipOf(user, screen.getByTestId("sessions-5"), /sign them out everywhere/);
    await tipOf(user, screen.getByTestId("tile-overdue"), /gone past their deadline/);
    await tipOf(user, screen.getByTestId("tile-atRisk"), /most of the allowed time/);
    await tipOf(user, screen.getByText("Not signed in yet", { selector: "span" }), /count as late after.'? minutes are still running/);
    await tipOf(user, screen.getByText("Late 12m"), /after the .count as late after. minutes/);
  });

  it("a status tooltip opens on keyboard focus too", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Today />, { route: "/today?tab=team" });
    await screen.findByTestId("person-card-5");
    const onPill = () => document.activeElement?.tagName === "SPAN" && document.activeElement.textContent === "Not signed in yet";
    for (let i = 0; i < 60 && !onPill(); i += 1) await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/still running/);
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
  it("TAT: guide and column tooltips say how each number is counted", async () => {
    signIn(true);
    mockReportEndpoints("/api/reports/tat", {
      kpis: { Finished: 8, OnTime: 6, OnTimePct: 75, Missed: 2, NotExcused: 1, Excused: 0, NoDecision: 1, ReasonPending: 0, OverdueNow: 0, MedianUsedPct: 70, P90UsedPct: 120 },
      rows: [{ GroupKey: "5", GroupLabel: "Asha", Finished: 8, OnTime: 6, OnTimePct: 75, Missed: 2, NotExcused: 1, Excused: 0, NoDecision: 1, ReasonPending: 0, OverdueNow: 0, MedianUsedPct: 70 }],
      trend: [], previous: { Finished: 0, OnTime: 0 },
    });
    const user = userEvent.setup();
    renderWithProviders(<TatReport />, { route: "/reports/tat" });
    const table = await screen.findByTestId("tat-table");
    await tipOf(user, within(table).getByText("Health"), /Red: late now or late without excuse/);
    await tipOf(user, within(table).getByText("Missed"), /still undecided/);
    await tipOf(user, within(table).getByText("Waiting for"), /reason, or your decision/);
    await guideWorks(user, /Missed counts by the day the deadline was missed.*Every number opens its list/s, /डेडलाइन निकली/);
  });

  it("Attendance: guide, the late-streak dot and the half-day / online notes", async () => {
    signIn(true);
    mockReportEndpoints("/api/reports/attendance", {
      kpis: { PresentPct: 75, PresentDays: 1.5, WorkingDays: 2, LateCount: 1, LateMinutesTotal: 14, LateMinutesMedian: 14, Absent: 0, AbsentTop: [], OnlineMedianMin: 300, ShiftMedianMin: 540 },
      days: ["2026-10-01", "2026-10-02"],
      rows: [{
        UserId: 5, FullName: "Asha", Present: 1.5, WorkingDays: 2, Late: 1, LateMinutes: 14, Absent: 0, Leave: 0.5, LeftEarly: 0,
        OnlineMedianMin: 300, ShiftMedianMin: 540, LateStreak: true,
        cells: [{ date: "2026-10-01", code: "late", lateMin: 14, onlineMin: 300 }, { date: "2026-10-02", code: "half", lateMin: 0, onlineMin: 200 }],
      }],
      range: { from: "2026-10-01", to: "2026-10-02" },
    });
    const user = userEvent.setup();
    renderWithProviders(<AttendanceReport />, { route: "/reports/attendance" });
    await screen.findByTestId("attendance-grid");
    expect(screen.getByLabelText("Late 3 working days in a row")).toBeInTheDocument();
    expect(screen.getByText(/½ day counts as half a working day.*not hours worked/)).toBeInTheDocument();
    await guideWorks(user, /½ day counts as half a day.*not hours worked.*late 3 working days in a row/s, /आधा दिन/);
  });
});
