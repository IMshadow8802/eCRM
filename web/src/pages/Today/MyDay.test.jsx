import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes, useLocation } from "react-router-dom";

import MyDay from "./MyDay";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import { tatHandlers } from "../../test/tatMocks";
import renderWithProviders from "../../test/renderWithProviders";

const ok = (data = {}) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });

const NO_FLAGS = { given: false, done: false, doneLate: false, open: true, working: false, notStarted: false, dueToday: false, overdue: false, atRisk: false, onHold: false, reasonOwed: false, toRule: false };
const task = (TaskId, Title, flags = {}, extra = {}) => ({
  TaskId, TatId: TaskId * 10, Title, WorkspaceId: 1, WorkspaceName: "Sales", AssignedByName: "Raaj", Priority: "medium",
  StepsTotal: 0, StepsDone: 0, HoldReason: null, CompletedDate: null, BreachedAt: null,
  due: null, timer: "clock", timeLeftMin: 120, flags: { ...NO_FLAGS, ...flags }, ...extra,
});

const TASKS = [
  task(1, "At risk task", { atRisk: true, working: true }, { timeLeftMin: 45, StepsTotal: 5, StepsDone: 3 }),
  task(2, "Overdue task", { overdue: true, notStarted: true }, { timeLeftMin: -130 }),
  task(3, "Missed task", { reasonOwed: true, overdue: true, working: true }, { BreachedAt: "2026-10-08 10:00:00", timeLeftMin: -3000 }),
  task(4, "Due call", { dueToday: true, working: true }, { due: "2026-10-11 14:00:00", timeLeftMin: 80, StepsTotal: 2, StepsDone: 1 }),
  task(5, "Held task", { onHold: true, working: true }, { HoldReason: "client reply", timeLeftMin: null }),
  task(6, "Fresh clocked", { notStarted: true }, { timeLeftMin: 360 }),
  task(7, "Fresh no clock", { notStarted: true }, { TatId: null, timer: "none", timeLeftMin: null }),
  task(8, "Done on time", { done: true, open: false }, { CompletedDate: "2026-10-11 11:20:00" }),
  task(9, "Done late", { done: true, doneLate: true, open: false }, { CompletedDate: "2026-10-11 13:05:00" }),
];

const me = (over = {}) => ({
  UserId: 1, FullName: "Ayush Mishra", JobTitle: "Dev", BranchId: 1, PresenceExempt: false,
  ShiftStart: "2026-10-11 09:30:00", ShiftEnd: "2026-10-11 18:30:00", FirstSignInAt: "2026-10-11 09:42:00", LateMinutes: 12, SignedOutAt: null,
  LastSeenAt: "2026-10-11 14:00:00", HasOpenSession: true, MarkPart: null, MarkKind: null,
  status: { code: "online", label: "Online", late: "Late by 12 min" },
  session: { onlineMinutes: 250, signIns: 2, devices: ["web", "mobile"], lastSeenAt: "2026-10-11T08:30:00.000Z", open: true },
  counts: { given: 1, done: 2, doneLate: 1, open: 7, working: 4, notStarted: 3, dueToday: 1, overdue: 2, atRisk: 1, onHold: 1, reasonOwed: 1, toRule: 0 },
  tasks: TASKS,
  ...over,
});

let calls;
function setup(data = { day: { key: "2026-10-11", live: true }, me: me() }) {
  calls = [];
  let n = 0;
  useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1, FullName: "Ayush Mishra" }, UserId: 1, API_BASE_URL: "https://x/CRM" });
  server.use(...tatHandlers({ calls }));
  server.use(http.post("*/api/today/mine", () => { n += 1; calls.push(["mine", n]); return ok(data); }));
}

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}
const view = () => renderWithProviders(
  <Routes>
    <Route path="/today" element={<MyDay />} />
    <Route path="/tasks" element={<Where />} />
  </Routes>,
  { route: "/today" },
);
const rowsOf = (testId) => within(screen.getByTestId(testId)).queryAllByTestId(/^row-/).map((r) => r.getAttribute("data-testid"));

describe("MyDay", () => {
  beforeEach(() => setup());

  it("strip shows the late chip and online time", async () => {
    view();
    const strip = await screen.findByTestId("my-strip");
    expect(within(strip).getByText("Late 12m")).toBeInTheDocument();
    expect(within(strip).getByText("4h 10m")).toBeInTheDocument();
    expect(within(strip).getByText("09:42")).toBeInTheDocument();
    expect(within(strip).getByText("09:30–18:30")).toBeInTheDocument();
    expect(within(strip).getByText("1 on time · 1 late")).toBeInTheDocument();
    expect(within(strip).getByText("4 working on · 3 not started")).toBeInTheDocument();
    expect(screen.getByText(/Ayush/)).toBeInTheDocument();
    expect(screen.getByText(/3 things need you now/)).toBeInTheDocument();
  });

  it("Needs you now orders reason owed, then overdue, then close to deadline", async () => {
    view();
    await screen.findByTestId("needs-now");
    expect(rowsOf("needs-now")).toEqual(["row-3", "row-2", "row-1"]);
    expect(within(screen.getByTestId("needs-now")).getByText("Steps 3 of 5 done")).toBeInTheDocument();
  });

  it("Explain delay opens the reason dialog", async () => {
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole("button", { name: "Explain delay" }));
    expect(await screen.findByTestId("breach-reason-dialog")).toBeInTheDocument();
  });

  it("Accept posts acknowledge with the TatId and refetches", async () => {
    const user = userEvent.setup();
    view();
    const notStarted = await screen.findByTestId("not-started");
    await user.click(within(within(notStarted).getByTestId("row-6")).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(calls).toContainEqual(["acknowledge", { TaskId: 6, TatId: 60 }]));
    await waitFor(() => expect(calls.filter((c) => c[0] === "mine").length).toBe(2));
  });

  it("Accept is hidden for a task without a clock", async () => {
    view();
    const notStarted = await screen.findByTestId("not-started");
    expect(rowsOf("not-started")).toEqual(["row-2", "row-6", "row-7"]);
    expect(within(within(notStarted).getByTestId("row-7")).queryByRole("button")).toBeNull();
    expect(within(notStarted).getAllByRole("button", { name: "Accept" })).toHaveLength(2);
  });

  it("a personal task past its due date shows in Needs you now (regression: Nothing due)", async () => {
    setup({ day: { key: "2026-10-11", live: true }, me: me({ tasks: [task(11, "Personal chore", { overdue: true, notStarted: true }, { WorkspaceName: "Personal", TatId: null, timer: "none", timeLeftMin: -90, AssignedByName: null })] }) });
    view();
    const needs = await screen.findByTestId("needs-now");
    expect(within(needs).getByText("Personal chore")).toBeInTheDocument();
    expect(within(needs).getByText("Overdue 1h 30m")).toBeInTheDocument();
    expect(within(needs).getByText("Personal")).toBeInTheDocument();
  });

  it("sections list due today, working on and done", async () => {
    view();
    await screen.findByTestId("due-today");
    expect(rowsOf("due-today")).toEqual(["row-4"]);
    expect(within(screen.getByTestId("due-today")).getByText("14:00")).toBeInTheDocument();
    expect(within(screen.getByTestId("due-today")).getByText("1 / 2")).toBeInTheDocument();
    expect(rowsOf("working-on")).toEqual(["row-1", "row-3", "row-4", "row-5"]);
    expect(within(screen.getByTestId("working-on")).getByText("On hold · client reply")).toBeInTheDocument();
    expect(rowsOf("done-today")).toEqual(["row-8", "row-9"]);
    expect(within(screen.getByTestId("done-today")).getByText("Late · 13:05")).toBeInTheDocument();
  });

  it("every row opens its task", async () => {
    const user = userEvent.setup();
    view();
    await user.click(within(await screen.findByTestId("done-today")).getByText("Done late"));
    expect(screen.getByTestId("where")).toHaveTextContent("/tasks?taskId=9");
  });

  it("Open task in Needs you now opens the task", async () => {
    const user = userEvent.setup();
    view();
    const needs = await screen.findByTestId("needs-now");
    await user.click(within(needs).getAllByRole("button", { name: "Open task" })[0]);
    expect(screen.getByTestId("where")).toHaveTextContent("/tasks?taskId=2");
  });

  it("an empty day shows each section's empty line and no Needs you now", async () => {
    setup({ day: { key: "2026-10-11", live: true }, me: me({
      FirstSignInAt: null, LateMinutes: 0, ShiftStart: null, ShiftEnd: null,
      status: { code: "not_signed_in_yet", label: "Not signed in yet" },
      session: { onlineMinutes: 0, signIns: 0, devices: [], lastSeenAt: null, open: false },
      counts: { ...me().counts, done: 0, doneLate: 0, open: 0, working: 0, notStarted: 0, overdue: 0, atRisk: 0, reasonOwed: 0 },
      tasks: [],
    }) });
    view();
    expect(await screen.findByText("Nothing due today.")).toBeInTheDocument();
    expect(screen.getByText("Nothing in progress.")).toBeInTheDocument();
    expect(screen.getByText("Nothing waiting to start.")).toBeInTheDocument();
    expect(screen.getByText("Nothing finished yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("needs-now")).toBeNull();
    expect(screen.getByText(/Nothing needs you right now/)).toBeInTheDocument();
    expect(screen.queryByText(/Late \d/)).toBeNull();
    expect(within(screen.getByTestId("my-strip")).getByText("No shift")).toBeInTheDocument();
  });

  it("a past day hides live sections and never shows 0 for them", async () => {
    setup({ day: { key: "2026-10-09", live: false }, me: me({
      status: { code: "offline", label: "Offline" },
      counts: { given: 1, done: 2, doneLate: 1, open: null, working: null, notStarted: null, dueToday: null, overdue: null, atRisk: null, onHold: null, reasonOwed: null, toRule: null },
      tasks: TASKS.filter((t) => t.flags.done),
    }) });
    view();
    expect((await screen.findAllByText("Live counts only for today")).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("needs-now")).toBeNull();
    expect(screen.queryByTestId("due-today")).toBeNull();
    expect(screen.queryByTestId("not-started")).toBeNull();
    expect(rowsOf("done-today")).toEqual(["row-8", "row-9"]);
    expect(within(screen.getByTestId("my-strip")).queryByText("0")).toBeNull();
    expect(within(screen.getByTestId("my-strip")).getByText("Offline")).toBeInTheDocument();
  });

  it("an exempt person online shows the Online pill (regression: Not tracked read as Offline)", async () => {
    setup({ day: { key: "2026-10-11", live: true }, me: me({ PresenceExempt: true, status: { code: "not_tracked", label: "Not tracked", online: true } }) });
    view();
    const strip = await screen.findByTestId("my-strip");
    expect(within(strip).getByText("Online")).toBeInTheDocument();
    expect(within(strip).queryByText("Offline")).toBeNull();
  });

  it("a task done today that still owes a reason stays in Needs you now", async () => {
    setup({ day: { key: "2026-10-11", live: true }, me: me({ tasks: [task(12, "Finished late", { done: true, doneLate: true, open: false, reasonOwed: true }, { BreachedAt: "2026-10-11 10:00:00", CompletedDate: "2026-10-11 12:00:00" })] }) });
    view();
    const needs = await screen.findByTestId("needs-now");
    expect(within(needs).getByText("Finished late")).toBeInTheDocument();
    expect(within(needs).getByRole("button", { name: "Explain delay" })).toBeInTheDocument();
  });

  it("a failed load says so and Retry fetches again", async () => {
    let n = 0;
    server.use(http.post("*/api/today/mine", () => { n += 1; return HttpResponse.json({ success: false, message: "boom" }, { status: 500 }); }));
    const user = userEvent.setup();
    view();
    // useApiQuery retries once (~1 s backoff) before it gives up
    expect(await screen.findByText("Couldn't load your day", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText(/no work day/)).toBeNull();
    const before = n;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(n).toBeGreaterThan(before));
  });

  it("a zero in the strip is grey", async () => {
    setup({ day: { key: "2026-10-11", live: true }, me: me({ counts: { ...me().counts, open: 0 }, tasks: [] }) });
    view();
    const open = await screen.findByTestId("strip-open");
    expect(open).toHaveTextContent("0");
    expect(open.style.color).toBe("rgb(148, 163, 184)");
    expect(screen.getByTestId("strip-done").style.color).toBe("rgb(15, 23, 42)");
  });

  it("an inactive user (me: null) gets a clean empty state", async () => {
    setup({ day: { key: "2026-10-11", live: true }, me: null });
    view();
    expect(await screen.findByTestId("my-day-empty")).toBeInTheDocument();
  });

  it("each strip cell and section carries a tinted icon badge in its own hue", async () => {
    view();
    const strip = await screen.findByTestId("my-strip");
    const tones = [...strip.querySelectorAll("[data-tone]")].map((b) => b.dataset.tone);
    expect(tones).toEqual(["primary", "info", "success", "success", "violet"]);
    expect(screen.getByTestId("due-today").querySelector("[data-tone]").dataset.tone).toBe("warning");
    expect(screen.getByTestId("done-today").querySelector("[data-tone]").dataset.tone).toBe("success");
  });

  it("a task row opens its task on click, and says it is clickable", async () => {
    view();
    const row = (await screen.findAllByTestId(/^row-/))[0];
    expect(row).toHaveClass("nx-clickable");
    const id = row.dataset.testid.replace("row-", "");
    fireEvent.click(row);
    expect(screen.getByTestId("where")).toHaveTextContent(`/tasks?taskId=${id}`);
  });
});
