import { describe, it, expect, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import SessionsDialog from "./SessionsDialog";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const ok = (data = {}) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });
const S = (id, start, last, ended = null) => ({ SessionId: id, Device: `Device ${id}`, Ip: "1.2.3.4", StartedAt: start, LastSeenAt: last, EndedAt: ended });
const SESSIONS = [
  S(3, "2026-10-03 09:00:00", "2026-10-03 12:00:00"),
  // runs past midnight into the 3rd
  S(2, "2026-10-02 22:00:00", "2026-10-03 01:00:00", "2026-10-03 01:00:00"),
  S(1, "2026-10-01 09:00:00", "2026-10-01 18:00:00", "2026-10-01 18:00:00"),
];
const PERSON = { UserId: 80, FullName: "Kavya Nair" };

const mock = (sessions = SESSIONS) => server.use(http.post("*/api/presence/fetchSessions", () => ok({ sessions })));
const render = (props) => renderWithProviders(<SessionsDialog open person={PERSON} onClose={() => {}} {...props} />, { router: false });

describe("SessionsDialog", () => {
  beforeEach(() => useAuthStore.setState({ user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://x/CRM" }));

  it("without a date lists every sign-in", async () => {
    mock();
    render();
    expect(await screen.findByTestId("session-1")).toBeInTheDocument();
    expect(screen.getByTestId("session-2")).toBeInTheDocument();
    expect(screen.getByTestId("session-3")).toBeInTheDocument();
  });

  it("with a date lists only the sign-ins on that day, including one running past midnight", async () => {
    mock();
    render({ date: "2026-10-03" });
    expect(await screen.findByTestId("session-3")).toBeInTheDocument();
    expect(screen.getByTestId("session-2")).toBeInTheDocument();
    expect(screen.queryByTestId("session-1")).toBeNull();
    expect(screen.getByTestId("sessions-dialog")).toHaveTextContent("Sat 3 Oct 2026");
  });

  it("a day with none says so", async () => {
    mock();
    render({ date: "2026-09-30" });
    expect(await screen.findByText("No sign-ins on this day.")).toBeInTheDocument();
  });

  it("a day older than the kept list says it cannot tell", async () => {
    // the server keeps the latest 30; nothing that old was returned
    mock(Array.from({ length: 30 }, (_, i) => S(100 + i, "2026-10-05 09:00:00", "2026-10-05 10:00:00")));
    render({ date: "2026-09-01" });
    expect(await screen.findByText(/only the latest 30 sign-ins/i)).toBeInTheDocument();
  });

  it("an admin signs another person out everywhere", async () => {
    mock();
    let ended;
    server.use(http.post("*/api/presence/endSession", async ({ request }) => { ended = await request.json(); return ok({ ended: 1 }); }));
    render();
    await userEvent.click(await screen.findByTestId("sessions-end-all"));
    await userEvent.click(within(screen.getByTestId("sessions-confirm")).getByTestId("sessions-confirm-end"));
    await screen.findByTestId("session-1");
    expect(ended).toEqual({ UserId: 80 });
  });

  it("a failed sign-out shows the server's message", async () => {
    mock();
    server.use(http.post("*/api/presence/endSession", () => HttpResponse.json({ success: false, message: "Nope" }, { status: 400 })));
    render();
    await userEvent.click(await screen.findByTestId("sessions-end-all"));
    await userEvent.click(screen.getByTestId("sessions-confirm-end"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nope");
  });

  it("you cannot sign yourself out here", async () => {
    mock();
    useAuthStore.setState({ user: { UserId: 80 } });
    render();
    expect(await screen.findByTestId("sessions-end-all")).toBeDisabled();
  });
});
