import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import ClocksDrawer from "./ClocksDrawer";
import renderWithProviders from "../../test/renderWithProviders";
import { useLocation } from "react-router-dom";
function WhereAmI() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

import { server } from "../../test/mocks/server";

const BASE = {
  TatId: 1, TaskId: 501, TaskTitle: "Fix the invoice export", UserId: 80, FullName: "Kavya Nair", WorkspaceName: "Ops",
  AssignedAt: "2026-10-01 10:00:00", DueAt: "2026-10-02 10:00:00", ClosedAt: "2026-10-03 12:30:00", BreachedAt: "2026-10-02 10:00:00",
  Reason: "Waiting on client", BreachRemarks: "Client sent files late", Verdict: "excused", VerdictByName: "Ayush Mishra",
  VerdictRemarks: "Fair", WorkMinutes: 600, TargetMinutes: 480,
};

const mock = (clocks) => {
  const cap = {};
  server.use(http.post("*/api/reports/tatClocks", async ({ request }) => {
    cap.body = await request.json();
    return HttpResponse.json({ success: true, data: { clocks } });
  }));
  return cap;
};

const open = (props = {}) =>
  renderWithProviders(
    <ClocksDrawer open title="Kavya Nair · Excused" body={{ FromDate: "2026-09-10", ToDate: "2026-10-10", GroupBy: "person", GroupKey: "80", Metric: "excused" }} onClose={() => {}} {...props} />,
  );

describe("ClocksDrawer", () => {
  it("posts the body and lists task, person, due, finished, reason and decision", async () => {
    const cap = mock([BASE]);
    open();
    expect(await screen.findByText("Fix the invoice export")).toHaveAttribute("href", "/tasks?taskId=501");
    expect(cap.body).toEqual({ FromDate: "2026-09-10", ToDate: "2026-10-10", GroupBy: "person", GroupKey: "80", Metric: "excused" });
    const d = screen.getByTestId("clocks-drawer");
    expect(d).toHaveTextContent("Kavya Nair · Excused");
    expect(d).toHaveTextContent("Kavya Nair · Ops");
    expect(d).toHaveTextContent("Due 02 Oct 2026, 10:00 IST");
    expect(d).toHaveTextContent("Finished 03 Oct 2026, 12:30 IST");
    expect(d).toHaveTextContent("Reason: Waiting on client — Client sent files late");
    expect(d).toHaveTextContent("Excused by Ayush Mishra — Fair");
    expect(d).toHaveTextContent("Used 125% of the time allowed");
  });

  it("an open clock with no reason and no decision says so", async () => {
    mock([{ ...BASE, ClosedAt: null, Reason: null, BreachRemarks: null, Verdict: null, VerdictByName: null, VerdictRemarks: null, WorkMinutes: null }]);
    open();
    await screen.findByText("Fix the invoice export");
    const d = screen.getByTestId("clocks-drawer");
    expect(d).toHaveTextContent("Still open");
    expect(d).toHaveTextContent("No reason given yet");
    expect(d).toHaveTextContent("No decision yet");
    expect(d).not.toHaveTextContent("Used");
  });

  it("a clock that met its deadline shows no reason or decision lines", async () => {
    mock([{ ...BASE, BreachedAt: null, Reason: null, Verdict: null, VerdictByName: null, VerdictRemarks: null }]);
    open();
    await screen.findByText("Fix the invoice export");
    const d = screen.getByTestId("clocks-drawer");
    expect(d).not.toHaveTextContent("Reason");
    expect(d).not.toHaveTextContent("decision");
  });

  it("a not-excused verdict without remarks and a reason without remarks", async () => {
    mock([{ ...BASE, Verdict: "not_excused", VerdictRemarks: null, BreachRemarks: null }]);
    open();
    await screen.findByText("Fix the invoice export");
    const d = screen.getByTestId("clocks-drawer");
    expect(d).toHaveTextContent("Reason: Waiting on client");
    expect(d).toHaveTextContent("Not excused by Ayush Mishra");
  });

  it("empty list, and the 500 cap is stated", async () => {
    mock([]);
    const { unmount } = open();
    expect(await screen.findByText("No tasks here")).toBeInTheDocument();
    unmount();
    mock(Array.from({ length: 500 }, (_, i) => ({ ...BASE, TatId: i + 1 })));
    open();
    expect(await screen.findByText(/first 500/)).toBeInTheDocument();
  });

  it("closed drawer fetches nothing; Close calls onClose", async () => {
    const cap = mock([BASE]);
    const { unmount } = open({ open: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(cap.body).toBeUndefined();
    unmount();
    const onClose = vi.fn();
    open({ onClose });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("the whole row opens its task; it shows it is clickable", async () => {
    mock([BASE]);
    renderWithProviders(<><ClocksDrawer open title="t" body={{ Metric: "excused" }} onClose={() => {}} /><WhereAmI /></>);
    await screen.findByText("Fix the invoice export");
    const row = screen.getByTestId(`clock-${BASE.TatId}`);
    expect(row).toHaveClass("nx-clickable");
    fireEvent.click(within(row).getByText(/Due /));
    expect(screen.getByTestId("where")).toHaveTextContent("/tasks?taskId=501");
  });
});
