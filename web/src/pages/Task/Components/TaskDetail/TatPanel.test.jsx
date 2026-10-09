import { describe, it, expect } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import TatPanel from "./TatPanel";
import { eventText } from "../../../../utils/tatChip";
import { server } from "../../../../test/mocks/server";
import { tatHandlers } from "../../../../test/tatMocks";
import renderWithProviders from "../../../../test/renderWithProviders";

const ME = 7;
const clock = (o) => ({
  Id: 1, UserId: ME, FullName: "Me", AssignedAt: "2026-10-08T04:00:00Z", DueAt: "2026-10-08T12:00:00Z",
  ClosedAt: null, AcknowledgedAt: null, BreachedAt: null, BreachReasonId: null, Verdict: null, CanJudge: false, ...o,
});

function setup(tat, { canReassign = false } = {}) {
  const calls = [];
  server.use(...tatHandlers({ tat: { clocks: [], holds: [], events: [], ...tat }, calls }));
  renderWithProviders(
    <TatPanel task={{ Id: 501 }} canReassign={canReassign} currentUserId={ME} />,
    { router: false },
  );
  return { calls, user: userEvent.setup() };
}

const pick = async (user, testId, name) => {
  const box = screen.getByTestId(testId);
  await user.click(box.querySelector("[role='combobox']") ?? box);
  await user.click(await screen.findByRole("option", { name }));
};

describe("TatPanel", () => {
  it("no clocks -> empty state, no actions", async () => {
    setup({});
    expect(await screen.findByText("No deadline on this task")).toBeInTheDocument();
    expect(screen.queryByTestId("tat-hold-all")).toBeNull();
  });

  it("own open clock: Accept task + Put on hold, but not My part is done when alone", async () => {
    const { calls, user } = setup({ clocks: [clock()] });
    await user.click(await screen.findByTestId("tat-ack"));
    await waitFor(() => expect(calls).toEqual([["acknowledge", { TaskId: 501 }]]));
    expect(screen.getByTestId("tat-hold")).toBeInTheDocument();
    expect(screen.queryByTestId("tat-my-part-done")).toBeNull();
    expect(screen.queryByTestId("tat-release")).toBeNull();
    expect(screen.queryByTestId("tat-hold-all")).toBeNull(); // no reassign
  });

  it.each([
    [{}, "Running"],
    [{ BreachedAt: "2026-10-08T12:00:00Z" }, "Missed deadline"],
    [{ ClosedAt: "2026-10-08T13:00:00Z", CloseReason: "completed" }, "Done"],
    [{ ClosedAt: "2026-10-08T13:00:00Z", CloseReason: "my_part_done" }, "My part done"],
    [{ ClosedAt: "2026-10-08T13:00:00Z", CloseReason: "unassigned" }, "Unassigned"],
    [{ ClosedAt: "2026-10-08T13:00:00Z", CloseReason: "deleted" }, "Deleted"],
    [{ ClosedAt: "2026-10-08T13:00:00Z", CloseReason: "user_left" }, "Left the company"],
    [{ ClosedAt: "2026-10-08T13:00:00Z", CloseReason: "no_clock" }, "No deadline"],
  ])("status pill for %j is %s", async (over, pill) => {
    setup({ clocks: [clock(over)] });
    const card = await screen.findByTestId("tat-clock-1");
    expect(within(card).getAllByText(pill).length).toBeGreaterThan(0);
  });

  it("an open clock on hold reads On hold; an over-run clock on hold still reads Missed deadline", async () => {
    setup({
      clocks: [clock(), clock({ Id: 2, UserId: 9, FullName: "Bob", BreachedAt: "2026-10-08T12:00:00Z" })],
      holds: [{ HoldId: 1, TatId: 1, StartedAt: "2026-10-08T05:00:00Z", EndedAt: null, Kind: "manual", Reason: "Waiting" }],
    });
    expect(within(await screen.findByTestId("tat-clock-1")).getAllByText("On hold").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("tat-clock-2")).getAllByText("Missed deadline").length).toBeGreaterThan(0);
  });

  it("acknowledged clock offers no Accept task", async () => {
    setup({ clocks: [clock({ AcknowledgedAt: "2026-10-08T05:00:00Z" })] });
    await screen.findByTestId("tat-clock-1");
    expect(screen.queryByTestId("tat-ack")).toBeNull();
  });

  it("with another open clock, My part is done closes mine", async () => {
    const { calls, user } = setup({ clocks: [clock(), clock({ Id: 2, UserId: 9, FullName: "Bob" })] });
    await user.click(await screen.findByTestId("tat-my-part-done"));
    await waitFor(() => expect(calls).toEqual([["myPartDone", { TaskId: 501 }]]));
    // Bob's clock carries no buttons for me
    expect(within(screen.getByTestId("tat-clock-2")).queryAllByRole("button")).toHaveLength(0);
  });

  it("Put on hold needs a reason, then holds my clock", async () => {
    const { calls, user } = setup({ clocks: [clock()] });
    await user.click(await screen.findByTestId("tat-hold"));
    expect(screen.getByTestId("tat-form-save")).toBeDisabled();
    await pick(user, "tat-hold-reason", "Waiting on client");
    await user.type(screen.getByTestId("tat-remarks"), "No reply");
    await user.click(screen.getByTestId("tat-form-save"));
    await waitFor(() => expect(calls).toEqual([["hold", { TaskId: 501, Mine: true, ReasonId: 61, Remarks: "No reply" }]]));
    await waitFor(() => expect(screen.queryByTestId("tat-form")).toBeNull());
  });

  it("Cancel drops the hold form", async () => {
    const { calls, user } = setup({ clocks: [clock()] });
    await user.click(await screen.findByTestId("tat-hold"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("tat-form")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("own manual hold: Release, not Put on hold; the hold shows in the timeline", async () => {
    const { calls, user } = setup({
      clocks: [clock()],
      holds: [{ HoldId: 5, TatId: 1, Kind: "manual", Reason: "Waiting on client", Remarks: "No reply", StartedAt: "2026-10-08T05:00:00Z", EndedAt: null }],
    });
    await user.click(await screen.findByTestId("tat-release"));
    await waitFor(() => expect(calls).toEqual([["release", { TaskId: 501, Mine: true }]]));
    expect(screen.queryByTestId("tat-hold")).toBeNull();
    expect(screen.getByText(/now · Waiting on client \(No reply\)/)).toBeInTheDocument();
  });

  it("a blocked hold offers no Release (the dependency releases it)", async () => {
    setup({
      clocks: [clock()],
      holds: [{ HoldId: 6, TatId: 1, Kind: "blocked", StartedAt: "2026-10-08T05:00:00Z", EndedAt: "2026-10-08T06:00:00Z" }, { HoldId: 7, TatId: 1, Kind: "blocked", StartedAt: "2026-10-08T07:00:00Z", EndedAt: null }],
    });
    await screen.findByTestId("tat-clock-1");
    expect(screen.queryByTestId("tat-release")).toBeNull();
    expect(screen.getAllByText(/Blocked by a dependency/)).toHaveLength(2);
  });

  it("reassign: Hold all and Release all act on the task", async () => {
    const { calls, user } = setup(
      {
        clocks: [clock({ UserId: 9, FullName: "Bob" }), clock({ Id: 2, UserId: 10, FullName: "Cat" })],
        holds: [{ HoldId: 5, TatId: 2, Kind: "manual", Reason: "Other", StartedAt: "2026-10-08T05:00:00Z" }],
      },
      { canReassign: true },
    );
    await user.click(await screen.findByTestId("tat-release-all"));
    await waitFor(() => expect(calls).toEqual([["release", { TaskId: 501, Mine: false }]]));
    await user.click(screen.getByTestId("tat-hold-all"));
    await pick(user, "tat-hold-reason", "Other");
    await user.click(screen.getByTestId("tat-form-save"));
    await waitFor(() => expect(calls[1]).toEqual(["hold", { TaskId: 501, Mine: false, ReasonId: 63, Remarks: null }]));
  });

  it("own breach without a reason: Give reason opens the reason dialog", async () => {
    const { user } = setup({ clocks: [clock({ BreachedAt: "2026-10-08T12:00:00Z", ClosedAt: "2026-10-08T13:00:00Z", CloseReason: "completed" })] });
    await user.click(await screen.findByTestId("tat-give-reason"));
    expect(await screen.findByTestId("breach-reason-dialog")).toBeInTheDocument();
    expect(screen.getByText(/pending/)).toBeInTheDocument();
    expect(screen.getByText(/over by 1h/)).toBeInTheDocument();
  });

  it("a breach with a verdict asks for no reason (e.g. excused by the system)", async () => {
    setup({ clocks: [clock({ BreachedAt: "2026-10-08T12:00:00Z", Verdict: "excused", VerdictRemarks: "Holiday" })] });
    await screen.findByTestId("tat-clock-1");
    expect(screen.queryByTestId("tat-give-reason")).toBeNull();
  });

  it("a judge: Excused needs remarks, Not excused does not", async () => {
    const breached = clock({ UserId: 9, FullName: "Bob", BreachedAt: "2026-10-08T12:00:00Z", BreachReasonId: 71, BreachReason: "Waiting on someone", BreachRemarks: "Vendor", ReasonAt: "2026-10-08T13:00:00Z", CanJudge: true });
    const { calls, user } = setup({ clocks: [breached] });
    expect(await screen.findByText(/Waiting on someone \(Vendor\)/)).toBeInTheDocument();
    expect(screen.queryByTestId("tat-give-reason")).toBeNull(); // not my clock
    await user.click(screen.getByTestId("tat-excused"));
    expect(screen.getByTestId("tat-form-save")).toBeDisabled();
    await user.type(screen.getByTestId("tat-remarks"), "Vendor outage");
    await user.click(screen.getByTestId("tat-form-save"));
    await waitFor(() => expect(calls).toEqual([["saveVerdict", { TaskId: 501, TatId: 1, Verdict: "excused", Remarks: "Vendor outage" }]]));
    await user.click(screen.getByTestId("tat-not-excused"));
    expect(screen.getByTestId("tat-form-save")).not.toBeDisabled();
    await user.click(screen.getByTestId("tat-form-save"));
    await waitFor(() => expect(calls[1]).toEqual(["saveVerdict", { TaskId: 501, TatId: 1, Verdict: "not_excused", Remarks: null }]));
  });

  it("a judged breach shows the verdict and offers no more judging", async () => {
    setup({ clocks: [clock({ UserId: 9, BreachedAt: "2026-10-08T12:00:00Z", Verdict: "excused", VerdictAt: "2026-10-08T14:00:00Z", VerdictRemarks: "Leave", CanJudge: true, ClosedAt: "2026-10-08T13:00:00Z", CloseReason: "my_part_done" })] });
    expect(await screen.findByText(/Delay accepted by the system \(Leave\)/)).toBeInTheDocument();
    expect(screen.queryByTestId("tat-excused")).toBeNull();
    expect(screen.getAllByText("My part done").length).toBeGreaterThan(0);
  });

  it("lists events with old -> new targets in IST and who did it", async () => {
    setup({
      clocks: [clock()],
      events: [
        { Id: 1, Kind: "change", OldValue: "2026-10-08 17:00:00", NewValue: "2026-10-08 18:30:00", ActorName: "Boss", At: "2026-10-08T06:00:00Z" },
      ],
    });
    expect(await screen.findByText(/Deadline changed 17:00 → 18:30 IST by Boss/)).toBeInTheDocument();
  });

  it("a refused action shows the server's message", async () => {
    const { user } = setup({ clocks: [clock()] });
    server.use(http.post("*/api/tat/acknowledge", () =>
      HttpResponse.json({ success: false, message: "No open clock", responseCode: 404 }, { status: 404 })));
    await user.click(await screen.findByTestId("tat-ack"));
    expect(await screen.findByText("No open clock")).toBeInTheDocument();
  });

  it("a success:false body is an error too", async () => {
    const { user } = setup({ clocks: [clock()] });
    server.use(http.post("*/api/tat/acknowledge", () => HttpResponse.json({ success: false })));
    await user.click(await screen.findByTestId("tat-ack"));
    expect(await screen.findByText("Operation failed")).toBeInTheDocument();
  });
});

describe("eventText", () => {
  it.each([
    [{ Kind: "assign", NewValue: "2026-10-08 17:00:00" }, "Due set to 17:00 IST"],
    [{ Kind: "change", OldValue: "2026-10-07 17:00:00", NewValue: "2026-10-08 18:30:00" }, "Deadline changed Wed 17:00 → 18:30 IST"],
    [{ Kind: "assign" }, "Assigned"],
    [{ Kind: "reopen" }, "Reopened"],
    [{ Kind: "resume" }, "Timer restarted"],
    [{ Kind: "hold", NewValue: "blocked" }, "On hold: blocked by a dependency"],
    [{ Kind: "hold", NewValue: "Waiting on client" }, "Put on hold: Waiting on client"],
    [{ Kind: "hold" }, "Put on hold:"],
    [{ Kind: "release", NewValue: "auto" }, "Resumed automatically"],
    [{ Kind: "release", NewValue: "blocked" }, "Dependency done, timer running"],
    [{ Kind: "release" }, "Resumed"],
    [{ Kind: "acknowledge" }, "Accepted"],
    [{ Kind: "my_part_done" }, "Marked their part done"],
    [{ Kind: "reason", NewValue: "Scope grew" }, "Reason given: Scope grew"],
    [{ Kind: "reason" }, "Reason given:"],
    [{ Kind: "verdict", NewValue: "not_excused" }, "Decision: Delay rejected"],
    [{ Kind: "verdict", NewValue: "odd" }, "Decision: odd"],
    [{ Kind: "verdict" }, "Decision:"],
    [{ Kind: "mystery" }, "mystery"],
  ])("%o", (e, text) => {
    expect(eventText(e)).toBe(text);
  });
});
