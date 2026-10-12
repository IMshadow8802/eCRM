import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useLocation } from "react-router-dom";
import dayjs from "dayjs";

import TeamDay from "./TeamDay";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

vi.mock("../../components/ui/DateField", () => import("../../test/DateFieldStub"));

const ok = (data = {}) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });
const zero = { given: 0, done: 0, doneLate: 0, open: 0, working: 0, notStarted: 0, dueToday: 0, overdue: 0, atRisk: 0, onHold: 0, reasonOwed: 0, toRule: 0 };
const P = (UserId, FullName, o = {}) => ({
  UserId, FullName, JobTitle: "Sales", BranchId: 1, FirstSignInAt: null, LateMinutes: null,
  status: { code: "offline", label: "Offline" }, session: null, ...o, counts: { ...zero, ...o.counts },
});
const people = [
  P(1, "Ayush Me", { isMe: true, status: { code: "online", label: "Online" }, counts: { open: 2 } }),
  P(5, "Asha", { counts: { overdue: 3, open: 4, toRule: 1 } }),
  P(6, "Ravi", { status: { code: "not_signed_in", label: "Not signed in" } }),
  P(7, "Tej", { PresenceExempt: 1, status: { code: "not_tracked", label: "Not tracked" } }),
];
const TODAY = dayjs().format("YYYY-MM-DD");

let bodies;
let teamRows;
let day;
function setup({ admin = false } = {}) {
  bodies = { team: [], tasks: [], marks: [] };
  teamRows = people;
  day = { key: TODAY, live: true };
  useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://x/CRM", access: { isAdmin: admin, modules: {} } });
  server.use(
    http.post("*/api/today/team", async ({ request }) => { bodies.team.push(await request.json()); return ok({ day, people: teamRows }); }),
    http.post("*/api/users/fetchBranches", () => ok({ branches: [{ Id: 1, BranchName: "Noida" }] })),
    http.post("*/api/today/personTasks", async ({ request }) => { bodies.tasks.push(await request.json()); return ok({ tasks: [{ TaskId: 9, Title: "Call client", WorkspaceName: "Sales", flags: { overdue: true }, timeLeftMin: -30 }] }); }),
    http.post("*/api/work/saveDayMark", async ({ request }) => { bodies.marks.push(await request.json()); return ok({ id: 1 }); }),
    http.post("*/api/presence/fetchSessions", () => ok({ sessions: [{ SessionId: 1, Device: "Chrome on Mac", StartedAt: `${TODAY} 09:12:00` }] })),
  );
}
function Where() {
  return <div data-testid="where">{useLocation().search}</div>;
}
const view = (route = "/today?tab=team") => renderWithProviders(<><TeamDay /><Where /></>, { route });
const cards = () => screen.getAllByTestId(/^person-card-/).map((c) => c.dataset.testid);

describe("TeamDay", () => {
  beforeEach(() => { setup(); localStorage.clear(); });
  afterEach(() => vi.restoreAllMocks());

  it("caller's card first, labelled You, with office names; sends today's WorkDate", async () => {
    view();
    await screen.findByTestId("person-card-1");
    expect(cards()[0]).toBe("person-card-1");
    expect(within(screen.getByTestId("person-card-1")).getByText("You")).toBeInTheDocument();
    expect(await within(screen.getByTestId("person-card-5")).findByText("Sales · Noida")).toBeInTheDocument();
    expect(bodies.team[0]).toEqual({ WorkDate: TODAY });
    // regression: admins see their whole reach, not only reports
    expect(screen.getByText(/3 people in your team/)).toBeInTheDocument();
  });

  it("PresenceExempt shows Not tracked", async () => {
    view();
    const c = await screen.findByTestId("person-card-7");
    expect(within(c).getAllByText("Not tracked").length).toBeGreaterThan(0);
  });

  it("tile Overdue filters to people with overdue > 0; a second click restores", async () => {
    const user = userEvent.setup();
    view();
    await screen.findByTestId("person-card-1");
    await user.click(screen.getByTestId("tile-overdue"));
    expect(cards()).toEqual(["person-card-5"]);
    expect(screen.getByTestId("showing")).toHaveTextContent("Overdue tasks · 1");
    await user.click(screen.getByTestId("tile-overdue"));
    expect(cards()).toHaveLength(4);
    expect(screen.getByTestId("showing")).toHaveTextContent("Everyone · 4");
  });

  it("a number click opens the drawer with that bucket", async () => {
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole("button", { name: "Overdue: 3" }));
    const drawer = await screen.findByTestId("person-tasks-drawer");
    expect(await within(drawer).findByText("Call client")).toBeInTheDocument();
    expect(bodies.tasks[0]).toEqual({ UserId: 5, Bucket: "overdue", WorkDate: TODAY });
    await user.click(within(drawer).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByTestId("person-tasks-drawer")).toBeNull());
  });

  it("Rule opens the person's waiting-for-ruling tasks", async () => {
    const user = userEvent.setup();
    view();
    await user.click(await within(await screen.findByTestId("missed-5")).findByRole("button", { name: "Rule" }));
    await screen.findByTestId("person-tasks-drawer");
    await waitFor(() => expect(bodies.tasks[0]).toMatchObject({ UserId: 5, Bucket: "toRule" }));
  });

  it("past day from the URL: sent as WorkDate, live numbers a dash, never opens a live bucket", async () => {
    const past = dayjs().subtract(2, "day").format("YYYY-MM-DD");
    day = { key: past, live: false };
    teamRows = [P(1, "Ayush Me", { isMe: true, counts: { given: 2, open: null, working: null, overdue: null, atRisk: null, toRule: null, reasonOwed: null } })];
    const user = userEvent.setup();
    view(`/today?tab=team&day=${past}`);
    await screen.findByTestId("person-card-1");
    expect(bodies.team[0]).toEqual({ WorkDate: past });
    expect(screen.getByText("Live counts only for today")).toBeInTheDocument();
    expect(screen.getByTestId("n-1-overdue")).toHaveTextContent("—");
    expect(screen.queryByRole("button", { name: /^Overdue:/ })).toBeNull();
    expect(within(screen.getByTestId("person-card-1")).getByText("Given")).toBeInTheDocument();
    expect(within(screen.getByTestId("person-card-1")).queryByText("Given today")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Given: 2" }));
    await screen.findByTestId("person-tasks-drawer");
    await waitFor(() => expect(bodies.tasks[0]).toEqual({ UserId: 1, Bucket: "given", WorkDate: past }));
  });

  it("the day picker writes ?day= and keeps tab; a future or bad ?day= falls back to today", async () => {
    view("/today?tab=team&day=2999-01-01");
    await screen.findByTestId("person-card-1");
    expect(bodies.team[0]).toEqual({ WorkDate: TODAY });
    fireEvent.change(screen.getByTestId("team-day"), { target: { value: "2026-10-01" } });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("day=2026-10-01"));
    expect(screen.getByTestId("where")).toHaveTextContent("tab=team");
    await waitFor(() => expect(bodies.team.at(-1)).toEqual({ WorkDate: "2026-10-01" }));
    fireEvent.change(screen.getByTestId("team-day"), { target: { value: "" } }); // cleared: ignored
    expect(screen.getByTestId("where")).toHaveTextContent("day=2026-10-01");
  });

  it("a live tile picked today is dropped on a past day, so everyone shows", async () => {
    const past = dayjs().subtract(1, "day").format("YYYY-MM-DD");
    const nulls = { open: null, working: null, overdue: null, atRisk: null, toRule: null, reasonOwed: null };
    server.use(http.post("*/api/today/team", async ({ request }) => {
      const { WorkDate } = await request.json();
      return WorkDate === TODAY ? ok({ day, people }) : ok({ day: { key: past, live: false }, people: people.map((x) => ({ ...x, counts: { ...x.counts, ...nulls } })) });
    }));
    const user = userEvent.setup();
    view();
    await screen.findByTestId("person-card-1");
    await user.click(screen.getByTestId("tile-overdue"));
    expect(cards()).toEqual(["person-card-5"]);
    fireEvent.change(screen.getByTestId("team-day"), { target: { value: past } });
    await screen.findByText("Live counts only for today");
    expect(cards()).toHaveLength(4);
    expect(screen.getByTestId("showing")).toHaveTextContent("Everyone · 4");
    expect(screen.getByTestId("tile-overdue")).toHaveAttribute("aria-pressed", "false");
  });

  it("a tile that matches nobody says so and Clear restores everyone", async () => {
    const user = userEvent.setup();
    view();
    await screen.findByTestId("person-card-1");
    await user.click(screen.getByTestId("tile-late"));
    expect(screen.getByText("No one matches this tile")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(cards()).toHaveLength(4);
  });

  it("an impossible ?day= (Feb 30) falls back to today", async () => {
    view("/today?tab=team&day=2026-02-30");
    await screen.findByTestId("person-card-1");
    expect(bodies.team[0]).toEqual({ WorkDate: TODAY });
  });

  it("past-day table headers say Given and Done", async () => {
    const past = dayjs().subtract(2, "day").format("YYYY-MM-DD");
    day = { key: past, live: false };
    localStorage.setItem("today.teamView", "table");
    view(`/today?tab=team&day=${past}`);
    await screen.findByTestId("team-table");
    expect(screen.getAllByText("Given").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Done").length).toBeGreaterThan(0);
    expect(screen.queryByText("Given today")).toBeNull();
  });

  it("Cards/Table switch persists in localStorage", async () => {
    const user = userEvent.setup();
    const { unmount } = view();
    await screen.findByTestId("person-card-1");
    await user.click(screen.getByRole("button", { name: "Table" }));
    expect(await screen.findByTestId("team-table")).toBeInTheDocument();
    expect(screen.getByTestId("team-row-5")).toBeInTheDocument();
    expect(within(screen.getByTestId("team-row-5")).getByRole("button", { name: "Overdue: 3" })).toBeInTheDocument();
    expect(localStorage.getItem("today.teamView")).toBe("table");
    unmount();
    view();
    expect(await screen.findByTestId("team-table")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cards" }));
    expect(await screen.findByTestId("person-card-1")).toBeInTheDocument();
  });

  it("survives localStorage throwing", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const user = userEvent.setup();
    view();
    await screen.findByTestId("person-card-1");
    await user.click(screen.getByRole("button", { name: "Table" }));
    expect(await screen.findByTestId("team-table")).toBeInTheDocument();
  });

  it("defaults to table when more than 24 people", async () => {
    teamRows = Array.from({ length: 26 }, (_, i) => P(i + 1, `P${i + 1}`, { isMe: i === 0 }));
    view();
    expect(await screen.findByTestId("team-table")).toBeInTheDocument();
  });

  it("DayMarkDialog and SessionsDialog still open from a card", async () => {
    setup({ admin: true });
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByTestId("mark-day-5"));
    await user.click(screen.getByTestId("day-mark-save"));
    await waitFor(() => expect(bodies.marks[0]).toMatchObject({ UserId: 5, WorkDate: TODAY }));
    await waitFor(() => expect(screen.queryByTestId("day-mark-dialog")).toBeNull());
    expect(screen.queryByTestId("sessions-1")).toBeNull();
    await user.click(screen.getByTestId("sessions-5"));
    expect(await screen.findByText("Chrome on Mac")).toBeInTheDocument();
  });

  it("table actions open the dialogs too", async () => {
    setup({ admin: true });
    localStorage.setItem("today.teamView", "table");
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByTestId("mark-day-6"));
    expect(await screen.findByTestId("day-mark-dialog")).toBeInTheDocument();
  });

  it("table Actions column is wide enough and does not wrap (regression: 'Sign-i…' cut off)", async () => {
    setup({ admin: true });
    localStorage.setItem("today.teamView", "table");
    view();
    const table = await screen.findByTestId("team-table");
    const head = within(table).getAllByRole("columnheader").find((h) => h.textContent.includes("Actions"));
    expect(getComputedStyle(head).minWidth).toContain("260px");
    const sessions = await within(table).findByTestId("sessions-5");
    expect(sessions.closest("span[style]").style.flexWrap).toBe("nowrap");
  });

  it("Sign-ins on a past day opens that day's sign-ins (regression: always the latest)", async () => {
    setup({ admin: true });
    const past = dayjs().subtract(2, "day").format("YYYY-MM-DD");
    day = { key: past, live: false };
    const user = userEvent.setup();
    view(`/today?tab=team&day=${past}`);
    await user.click(await screen.findByTestId("sessions-5"));
    expect(await screen.findByText(`Asha · ${dayjs(past).format("ddd D MMM YYYY")}`)).toBeInTheDocument();
  });

  it("nobody to show, and an error with retry", async () => {
    teamRows = [];
    const { unmount } = view();
    expect(await screen.findByText("No one to show for this day.")).toBeInTheDocument();
    unmount();
    let n = 0;
    server.use(http.post("*/api/today/team", () => (++n <= 2 ? HttpResponse.json({ success: false, message: "x" }, { status: 500 }) : ok({ day, people }))));
    view();
    // useApiQuery retries once (~1 s backoff) before it gives up
    await userEvent.setup().click(await screen.findByRole("button", { name: "Retry" }, { timeout: 4000 }));
    expect(await screen.findByTestId("person-card-1")).toBeInTheDocument();
  });
});
