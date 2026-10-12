import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { useLocation } from "react-router-dom";
import Today from "./Today";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import { tatHandlers } from "../../test/tatMocks";
import renderWithProviders from "../../test/renderWithProviders";

vi.mock("../../components/ui/DateField", () => import("../../test/DateFieldStub"));

const ok = (data = {}) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });
const fail = (status, message) => HttpResponse.json({ success: false, message, responseCode: status }, { status });

const zero = { given: 0, done: 0, open: 0, working: 0, overdue: 0, atRisk: 0, reasonOwed: 0, toRule: 0 };
const row = (UserId, FullName, o = {}) => ({ UserId, FullName, FirstSignInAt: null, ...o, counts: { ...zero, ...o.counts } });
const team = [
  row(5, "Asha", { status: { code: "online", label: "Online", late: "Late by 12 min" }, LateMinutes: 12, FirstSignInAt: "2026-10-08 09:12:00", counts: { open: 3, atRisk: 1, overdue: 1, reasonOwed: 2 } }),
  row(6, "Ravi", { status: { code: "leave", label: "On leave" }, MarkKind: "leave", MarkPart: "full" }),
];

let calls;
let sized;
const mine = { day: { key: "2026-10-11", live: true }, me: {
  UserId: 1, FullName: "Ayush Mishra", FirstSignInAt: "2026-10-11 09:42:00", LateMinutes: 12,
  status: { code: "online", label: "Online", late: "Late by 12 min" },
  session: { onlineMinutes: 250, signIns: 1, devices: ["web"], lastSeenAt: null, open: true },
  counts: { done: 0, doneLate: 0, open: 0, working: 0, notStarted: 0 }, tasks: [] } };

function setup({ teamRows = team, admin = false, size = teamRows.length } = {}) {
  calls = [];
  sized = false;
  useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://x/CRM", access: { isAdmin: admin, modules: {} } });
  server.use(...tatHandlers());
  server.use(
    http.post("*/api/today/mine", () => ok(mine)),
    http.post("*/api/today/teamSize", () => { sized = true; return ok({ count: size }); }),
    http.post("*/api/today/team", () => ok({ day: { key: "2026-10-11", live: true }, people: teamRows })),
    http.post("*/api/users/fetchBranches", () => ok({ branches: [] })),
    http.post("*/api/work/saveDayMark", async ({ request }) => { const b = await request.json(); calls.push(["save", b]); return b.UserId === 6 ? fail(403, "Not your report") : ok({ id: 1 }); }),
    http.post("*/api/work/deleteDayMark", async ({ request }) => { calls.push(["delete", await request.json()]); return ok(); }),
    http.post("*/api/presence/fetchSessions", () => ok({ sessions: [{ SessionId: 1, Device: "Chrome on Mac", Ip: "1.2.3.4", StartedAt: "2026-10-08 09:12:00", LastSeenAt: "2026-10-08 10:00:00", EndedAt: null }] })),
    http.post("*/api/presence/endSession", async ({ request }) => { calls.push(["end", await request.json()]); return ok({ ended: 1 }); }),
  );
}
function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.search}</div>;
}
const view = (route = "/today") => renderWithProviders(<><Today /><Where /></>, { route });

describe("Today", () => {
  beforeEach(() => setup());

  it("shows the day mark: half leave on the presence line, full leave and on duty as the status", async () => {
    setup({ teamRows: [
      row(5, "Asha", { status: { code: "online", label: "Online", half: "first_half" } }),
      row(7, "Meena", { status: { code: "on_duty", label: "On duty" } }),
      row(8, "Kiran", { status: { code: "leave", label: "On leave" } }),
      row(9, "Plain", { status: { code: "offline", label: "Offline" } }),
    ] });
    view("/today?tab=team");
    expect(within(await screen.findByTestId("person-card-5")).getByText(/Leave · first half/)).toBeInTheDocument();
    expect(within(screen.getByTestId("person-card-7")).getAllByText("On duty").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("person-card-8")).getAllByText("On leave").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("person-card-9")).queryByText(/On leave|On duty/)).toBeNull();
  });

  it("Mine is the default tab and shows my day", async () => {
    view();
    expect(await screen.findByText("Late 12m")).toBeInTheDocument();
    expect(await screen.findByText("My team")).toBeInTheDocument();
  });

  it("switching tabs keeps other URL params", async () => {
    const user = userEvent.setup();
    view("/today?day=2026-10-09");
    await user.click(await screen.findByText("My team"));
    expect(screen.getByTestId("where")).toHaveTextContent("day=2026-10-09");
    expect(screen.getByTestId("where")).toHaveTextContent("tab=team");
  });

  it("hides the My team tab when teamSize is 0, even with ?tab=team", async () => {
    setup({ size: 0 });
    view("/today?tab=team");
    await screen.findByText("Late 12m");
    await waitFor(() => expect(sized).toBe(true));
    expect(screen.queryByText("My team")).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^person-card-/)).not.toBeInTheDocument();
  });

  it("team tab shows statuses and counts", async () => {
    const user = userEvent.setup();
    view("/today?tab=team");
    const asha = await screen.findByTestId("person-card-5");
    expect(within(asha).getByText("Late 12m")).toBeInTheDocument();
    expect(within(asha).getByRole("button", { name: "Open: 3" })).toBeInTheDocument();
    expect(within(screen.getByTestId("person-card-6")).getAllByText("On leave").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("sessions-5")).not.toBeInTheDocument();
    await user.click(screen.getByText("Mine"));
    expect(await screen.findByText("Late 12m")).toBeInTheDocument();
  });

  it("Mark day saves, and a 403 is shown in the dialog", async () => {
    const user = userEvent.setup();
    view("/today?tab=team");
    await user.click(await screen.findByTestId("mark-day-5"));
    expect(screen.queryByTestId("day-mark-remove")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("day-mark-save"));
    await waitFor(() => expect(calls[0][0]).toBe("save"));
    expect(calls[0][1]).toMatchObject({ UserId: 5, Part: "full", Kind: "leave", Remarks: null });
    await waitFor(() => expect(screen.queryByTestId("day-mark-dialog")).not.toBeInTheDocument());

    await user.click(screen.getByTestId("mark-day-6"));
    await user.click(screen.getByTestId("day-mark-save"));
    expect(await screen.findByText("Not your report")).toBeInTheDocument();
    await user.click(screen.getByTestId("day-mark-remove"));
    await waitFor(() => expect(calls.at(-1)).toEqual(["delete", expect.objectContaining({ UserId: 6 })]));
  });

  it("sessions: admins list and end them after confirming", async () => {
    setup({ admin: true });
    const user = userEvent.setup();
    view("/today?tab=team");
    await user.click(await screen.findByTestId("sessions-5"));
    expect(await screen.findByText("Chrome on Mac")).toBeInTheDocument();
    await user.click(screen.getByTestId("sessions-end-all"));
    await user.click(screen.getByTestId("sessions-confirm-end"));
    await waitFor(() => expect(calls).toContainEqual(["end", { UserId: 5 }]));
  });

  it("sessions: a failed end shows the message", async () => {
    setup({ admin: true });
    server.use(http.post("*/api/presence/endSession", () => fail(400, "Nope")));
    const user = userEvent.setup();
    view("/today?tab=team");
    await user.click(await screen.findByTestId("sessions-5"));
    await user.click(await screen.findByTestId("sessions-end-all"));
    await user.click(screen.getByTestId("sessions-confirm-end"));
    expect(await screen.findByText("Nope")).toBeInTheDocument();
  });

  it("sessions: no Sessions button on your own row; empty and ended sessions render", async () => {
    setup({ admin: true, teamRows: [row(1, "Me", { isMe: true }), row(5, "Asha")] });
    server.use(http.post("*/api/presence/fetchSessions", () => ok({ sessions: [{ SessionId: 3, EndedAt: "2026-10-08 10:00:00", EndReason: "forced" }] })));
    const user = userEvent.setup();
    view("/today?tab=team");
    await screen.findByTestId("person-card-1");
    expect(screen.queryByTestId("sessions-1")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("sessions-5"));
    expect(await screen.findByText(/\(forced\)/)).toBeInTheDocument();
    expect(screen.getByText("Unknown device")).toBeInTheDocument();
    await user.click(screen.getByTestId("sessions-end-all"));
    await user.click(within(screen.getByTestId("sessions-confirm")).getByRole("button", { name: "Cancel" }));
  });

  it("sessions: none yet; self cannot be ended", async () => {
    setup({ admin: true, teamRows: [row(1, "Me", { isMe: true }), row(5, "Asha")] });
    server.use(http.post("*/api/presence/fetchSessions", () => ok({ sessions: [] })));
    const user = userEvent.setup();
    view("/today?tab=team");
    await user.click(await screen.findByTestId("sessions-5"));
    expect(await screen.findByText("No sign-ins yet.")).toBeInTheDocument();
  });

  it("Mark day falls back to a generic error and Cancel closes", async () => {
    const user = userEvent.setup();
    server.use(http.post("*/api/work/saveDayMark", () => HttpResponse.error()));
    view("/today?tab=team");
    await user.click(await screen.findByTestId("mark-day-5"));
    await user.click(screen.getByTestId("day-mark-save"));
    expect(await screen.findByTestId("day-mark-error")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("day-mark-dialog")).not.toBeInTheDocument());
  });

  it("puts My team's Day picker on the tab row, not on a row of its own", async () => {
    setup();
    view("/today?tab=team");
    await screen.findByTestId("person-card-5");
    expect(screen.getByTestId("today-tabs-end")).toContainElement(screen.getByTestId("team-day"));
    expect(screen.getByText(/people in your team, most urgent first/)).toBeInTheDocument();
  });
});
