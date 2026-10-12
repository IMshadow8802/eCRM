import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import PersonTasksDrawer from "./PersonTasksDrawer";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import { useLocation } from "react-router-dom";
function WhereAmI() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}


const ok = (data) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });
const row = { TaskId: 11, Title: "Send quote", WorkspaceName: "Sales", StepsTotal: 5, StepsDone: 3, HoldReason: null, CompletedDate: null, BreachedAt: null, timer: "clock", timeLeftMin: 80, flags: { open: true, overdue: false, atRisk: false, onHold: false, done: false, reasonOwed: false } };

let body;
function setup(tasks, props = {}) {
  body = null;
  useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://x/CRM" });
  server.use(http.post("*/api/today/personTasks", async ({ request }) => { body = await request.json(); return ok({ tasks }); }));
  const onClose = vi.fn();
  renderWithProviders(<PersonTasksDrawer open userId={5} name="Asha" workDate="2026-10-08" bucket="overdue" onClose={onClose} {...props} />);
  return onClose;
}

describe("PersonTasksDrawer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads and lists rows with link, board, chip and steps", async () => {
    setup([row]);
    const link = await screen.findByRole("link", { name: "Send quote" });
    expect(link).toHaveAttribute("href", "/tasks?taskId=11");
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("1h 20m left")).toBeInTheDocument();
    expect(screen.getByText("3 of 5")).toBeInTheDocument();
    expect(screen.getByText(/Asha/)).toBeInTheDocument();
    expect(screen.getByText(/Overdue/)).toBeInTheDocument();
    expect(body).toEqual({ UserId: 5, Bucket: "overdue", WorkDate: "2026-10-08" });
  });

  it("a failed request says so with Retry, never 'Nothing here' (regression)", async () => {
    setup([row]);
    let n = 0;
    server.use(http.post("*/api/today/personTasks", () => (++n <= 2 ? HttpResponse.json({ success: false, message: "x" }, { status: 500 }) : ok({ tasks: [row] }))));
    // useApiQuery retries once (~1 s backoff) before it gives up
    const retry = await screen.findByRole("button", { name: "Retry" }, { timeout: 4000 });
    expect(screen.getByText("Couldn't load these tasks")).toBeInTheDocument();
    expect(screen.queryByText("Nothing here")).toBeNull();
    await userEvent.setup().click(retry);
    expect(await screen.findByRole("link", { name: "Send quote" })).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    setup([]);
    expect(await screen.findByText("Nothing here")).toBeInTheDocument();
  });

  it("omits the steps when a task has none and closes", async () => {
    const onClose = setup([{ ...row, StepsTotal: 0 }]);
    await screen.findByRole("link", { name: "Send quote" });
    expect(screen.queryByText(/ of /)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("does not fetch while closed", async () => {
    setup([row], { open: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(body).toBeNull();
  });
  // Regression: on a past day the title said "Done today" for a day that was not today.
  it("titles a past day without 'today'; a live day keeps it", async () => {
    setup([row], { bucket: "done", live: false });
    expect(await screen.findByText("Done")).toBeInTheDocument();
    expect(screen.queryByText("Done today")).not.toBeInTheDocument();
  });

  it("a live day says Given today", async () => {
    setup([row], { bucket: "given" });
    expect(await screen.findByText("Given today")).toBeInTheDocument();
  });

  it("the whole row opens its task", async () => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://x/CRM" });
    server.use(http.post("*/api/today/personTasks", () => ok({ tasks: [row] })));
    renderWithProviders(<><PersonTasksDrawer open userId={5} name="Asha" workDate="2026-10-08" bucket="overdue" onClose={() => {}} /><WhereAmI /></>);
    const r = await screen.findByTestId("drawer-task-11");
    expect(r).toHaveClass("nx-clickable");
    fireEvent.click(within(r).getByText("Sales"));
    expect(screen.getByTestId("where")).toHaveTextContent("/tasks?taskId=11");
  });
});
