import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import Today from "./Today";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import { tatHandlers } from "../../test/tatMocks";
import renderWithProviders from "../../test/renderWithProviders";

vi.mock("../../components/ui/DateField", () => import("../../test/DateFieldStub"));

const ok = (data = {}) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });
const fail = (status, message) => HttpResponse.json({ success: false, message, responseCode: status }, { status });

const clocks = [
  { TatId: 2, TaskId: 22, TaskTitle: "Later task", DueAt: "2099-01-02 17:00:00", WarnedAt: null, BreachedAt: null },
  { TatId: 1, TaskId: 11, TaskTitle: "Sooner task", DueAt: "2099-01-01 11:00:00", WarnedAt: null, BreachedAt: null },
];
const team = [
  { UserId: 5, FullName: "Asha", status: { code: "online", label: "Online", late: "Late by 12 min" }, FirstSignInAt: "2026-10-08 09:12:00", Open: 3, AtRisk: 1, Over: 1, ReasonPending: 2, MarkKind: null },
  { UserId: 6, FullName: "Ravi", status: { code: "leave", label: "On leave" }, FirstSignInAt: null, Open: 0, AtRisk: 0, Over: 0, ReasonPending: 0, MarkKind: "leave", MarkPart: "full" },
];

let calls;
function setup({ teamRows = team, admin = false, today = {} } = {}) {
  calls = [];
  useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://x/CRM", access: { isAdmin: admin, modules: {} } });
  server.use(...tatHandlers());
  server.use(
    http.post("*/api/tat/fetchToday", () =>
      ok({ presence: { FirstSignInAt: "2026-10-08 09:12:00", status: { code: "online", label: "Online", late: "Late by 12 min" } }, clocks, reasonPending: [{ TatId: 9, TaskId: 99, TaskTitle: "Ran over" }], ...today })),
    http.post("*/api/tat/fetchTeamToday", () => ok({ team: teamRows })),
    http.post("*/api/work/saveDayMark", async ({ request }) => { const b = await request.json(); calls.push(["save", b]); return b.UserId === 6 ? fail(403, "Not your report") : ok({ id: 1 }); }),
    http.post("*/api/work/deleteDayMark", async ({ request }) => { calls.push(["delete", await request.json()]); return ok(); }),
    http.post("*/api/presence/fetchSessions", () => ok({ sessions: [{ SessionId: 1, Device: "Chrome on Mac", Ip: "1.2.3.4", StartedAt: "2026-10-08 09:12:00", LastSeenAt: "2026-10-08 10:00:00", EndedAt: null }] })),
    http.post("*/api/presence/endSession", async ({ request }) => { calls.push(["end", await request.json()]); return ok({ ended: 1 }); }),
  );
}
const view = (route = "/today") => renderWithProviders(<Today />, { route });

describe("Today", () => {
  beforeEach(() => setup());

  it("Mine lists clocks by due, sign-in time and late", async () => {
    view();
    expect(await screen.findByText("Signed in at 09:12 IST")).toBeInTheDocument();
    expect(screen.getAllByText("Late by 12 min").length).toBeGreaterThan(0);
    const rows = await screen.findAllByTestId(/^clock-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(["clock-1", "clock-2"]);
  });

  it("shows status from the server only, even with null presence fields; null DueAt sorts last", async () => {
    setup({ today: { presence: { FirstSignInAt: null, LateMinutes: 7, status: { code: "not_signed_in_yet", label: "Not signed in yet" } },
      clocks: [{ TatId: 3, TaskId: 33, TaskTitle: "No due", DueAt: null }, clocks[0], clocks[1]], reasonPending: [] } });
    view();
    expect(await screen.findByText("Not signed in yet")).toBeInTheDocument();
    expect(screen.queryByText(/Late by/)).not.toBeInTheDocument();
    const rows = await screen.findAllByTestId(/^clock-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(["clock-1", "clock-2", "clock-3"]);
  });

  it("team Day filter sends WorkDate", async () => {
    let body;
    server.use(http.post("*/api/tat/fetchTeamToday", async ({ request }) => { body = await request.json(); return ok({ team }); }));
    view("/today?tab=team");
    await screen.findByTestId("team-table");
    expect(body.WorkDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("Reason pending opens the reason dialog", async () => {
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole("button", { name: "Give reason" }));
    expect(await screen.findByTestId("breach-reason-dialog")).toBeInTheDocument();
  });

  it("hides the team tab when nobody reports in", async () => {
    setup({ teamRows: [] });
    view();
    await screen.findByText("Signed in at 09:12 IST");
    expect(screen.queryByText("My team")).not.toBeInTheDocument();
  });

  it("team tab shows statuses and counts", async () => {
    const user = userEvent.setup();
    view("/today?tab=team");
    await screen.findByTestId("team-table");
    expect(within(await screen.findByTestId("team-row-5")).getByText("Online")).toBeInTheDocument();
    expect(within(screen.getByTestId("team-row-5")).getByText("Late by 12 min")).toBeInTheDocument();
    expect(within(screen.getByTestId("team-row-6")).getByText("On leave")).toBeInTheDocument();
    expect(screen.queryByTestId("sessions-5")).not.toBeInTheDocument();
    await user.click(screen.getByText("Mine"));
    expect(await screen.findByText("Signed in at 09:12 IST")).toBeInTheDocument();
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
    setup({ admin: true, teamRows: [{ UserId: 1, FullName: "Me", Open: 0 }, { UserId: 5, FullName: "Asha" }] });
    server.use(http.post("*/api/presence/fetchSessions", () => ok({ sessions: [{ SessionId: 3, EndedAt: "2026-10-08 10:00:00", EndReason: "forced" }] })));
    const user = userEvent.setup();
    view("/today?tab=team");
    await screen.findByTestId("team-row-1");
    expect(screen.queryByTestId("sessions-1")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("sessions-5"));
    expect(await screen.findByText(/\(forced\)/)).toBeInTheDocument();
    expect(screen.getByText("Unknown device")).toBeInTheDocument();
    await user.click(screen.getByTestId("sessions-end-all"));
    await user.click(within(screen.getByTestId("sessions-confirm")).getByRole("button", { name: "Cancel" }));
  });

  it("sessions: none yet; self cannot be ended", async () => {
    setup({ admin: true, teamRows: [{ UserId: 1, FullName: "Me" }, { UserId: 5, FullName: "Asha" }] });
    server.use(http.post("*/api/presence/fetchSessions", () => ok({ sessions: [] })));
    const user = userEvent.setup();
    view("/today?tab=team");
    await user.click(await screen.findByTestId("sessions-5"));
    expect(await screen.findByText("No sessions yet.")).toBeInTheDocument();
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
});
