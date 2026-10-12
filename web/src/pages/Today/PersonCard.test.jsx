import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PersonCard from "./PersonCard";
import { statusWord } from "./todayWords";
import renderWithProviders from "../../test/renderWithProviders";

const counts = { given: 2, done: 1, doneLate: 0, open: 6, working: 3, notStarted: 3, dueToday: 1, overdue: 1, atRisk: 0, onHold: 0, reasonOwed: 0, toRule: 0 };
const person = (o = {}) => ({
  UserId: 5, FullName: "Priya Singh", JobTitle: "Accounts", BranchId: 1, PresenceExempt: 0,
  ShiftStart: "2026-10-11 09:30:00", ShiftEnd: "2026-10-11 18:30:00", FirstSignInAt: "2026-10-11 09:52:00", LateMinutes: 22,
  status: { code: "online", label: "Online", late: "Late by 22 min" },
  session: { onlineMinutes: 220, signIns: 2, devices: ["web", "mobile"], lastSeenAt: null, open: true },
  ...o,
  counts: { ...counts, ...o.counts },
});

function card(props = {}) {
  const on = { onOpen: vi.fn(), onMark: vi.fn(), onSessions: vi.fn() };
  renderWithProviders(<PersonCard person={person(props.p)} live office="Noida" {...on} {...props} />);
  return on;
}

describe("statusWord", () => {
  it.each([
    [{ code: "online" }, { FirstSignInAt: "2026-10-11 09:00:00" }, "On time"],
    [{ code: "offline" }, { FirstSignInAt: "2026-10-11 09:00:00" }, "On time"],
    // regression: a Sunday with no sign-in said "On time"
    [{ code: "offline" }, { ShiftStart: null }, "Day off"],
    [{ code: "offline" }, { ShiftStart: "2026-10-11 09:30:00" }, "Offline"],
    // regression: signed_out hid lateness
    [{ code: "signed_out", late: "Late by 22 min" }, { LateMinutes: 22 }, "Late 22m"],
    [{ code: "offline", late: "x" }, { LateMinutes: 22 }, "Late 22m"],
    [{ code: "online", late: "Late by 5 min" }, { LateMinutes: null }, "Late by 5 min"],
    [{ code: "not_signed_in" }, {}, "Not signed in"],
    [{ code: "not_signed_in_yet" }, {}, "Not signed in yet"],
    [{ code: "leave" }, {}, "On leave"],
    [{ code: "on_duty" }, {}, "On duty"],
    [{ code: "holiday" }, {}, "Holiday"],
    [{ code: "not_tracked" }, {}, "Not tracked"],
    [{ code: "signed_out" }, {}, "Signed out"],
    [{ code: "weird", label: "Weird" }, {}, "Weird"],
    [undefined, {}, ""],
  ])("%o → %s", (status, extra, word) => {
    expect(statusWord({ status, ...extra }).label).toBe(word);
  });
  it("Day off is a default tone with a no-shift hint", () => {
    expect(statusWord({ status: { code: "offline" } })).toEqual({ label: "Day off", tone: "default", hint: "No shift today" });
  });
});

describe("PersonCard", () => {
  it("shows who, where, status, presence line and six numbers", () => {
    card();
    const c = screen.getByTestId("person-card-5");
    expect(c).toHaveTextContent("Priya Singh");
    expect(c).toHaveTextContent("Accounts · Noida");
    expect(c).toHaveTextContent("Late 22m");
    expect(c).toHaveTextContent("In 09:52 · online 3h 40m · 2 sign-ins (web, mobile)");
    expect(within(c).getByRole("button", { name: "Given today: 2" })).toBeInTheDocument();
    expect(within(c).getByRole("button", { name: "Overdue: 1" })).toBeInTheDocument();
    // zero is grey text, not a button
    expect(within(c).queryByRole("button", { name: /Close to deadline/ })).toBeNull();
    expect(within(c).getByTestId("n-5-atRisk")).toHaveTextContent("0");
    expect(within(c).queryByText("You")).toBeNull();
  });

  it("a number click opens that bucket", async () => {
    const on = card();
    await userEvent.setup().click(screen.getByRole("button", { name: "Working on: 3" }));
    expect(on.onOpen).toHaveBeenCalledWith(expect.objectContaining({ UserId: 5 }), "working");
  });

  it("past day: live numbers are a dash and not clickable; given/done stay", () => {
    card({ live: false, p: { counts: { open: null, working: null, overdue: null, atRisk: null } } });
    const c = screen.getByTestId("person-card-5");
    for (const k of ["open", "working", "overdue", "atRisk"]) {
      expect(within(c).getByTestId(`n-5-${k}`)).toHaveTextContent("—");
    }
    expect(within(c).queryByRole("button", { name: /Overdue|Open|Working/ })).toBeNull();
    expect(within(c).getByRole("button", { name: "Done: 1" })).toBeInTheDocument();
  });

  it("past day: no missed box even if counts leak", () => {
    card({ live: false, p: { counts: { toRule: 2 } } });
    expect(screen.queryByTestId("missed-5")).toBeNull();
  });

  it("missed box: reason and ruling, Rule opens the toRule bucket", async () => {
    const on = card({ p: { counts: { reasonOwed: 1, toRule: 2 } } });
    const box = screen.getByTestId("missed-5");
    expect(box).toHaveTextContent("1 waiting for reason · 2 waiting for your ruling");
    await userEvent.setup().click(within(box).getByRole("button", { name: "Rule" }));
    expect(on.onOpen).toHaveBeenCalledWith(expect.anything(), "toRule");
  });

  it("missed box without ruling has no Rule button", () => {
    card({ p: { counts: { reasonOwed: 2 } } });
    expect(screen.getByTestId("missed-5")).toHaveTextContent("2 waiting for reason");
    expect(within(screen.getByTestId("missed-5")).queryByRole("button")).toBeNull();
  });

  it("own card says You and has no Sign-ins; others get Sign-ins when allowed", async () => {
    const on = card({ p: { isMe: true }, canSessions: true });
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.queryByTestId("sessions-5")).toBeNull();
    await userEvent.setup().click(screen.getByTestId("mark-day-5"));
    expect(on.onMark).toHaveBeenCalled();
  });

  it("Sign-ins button for an admin on someone else", async () => {
    const on = card({ canSessions: true });
    await userEvent.setup().click(screen.getByTestId("sessions-5"));
    expect(on.onSessions).toHaveBeenCalled();
  });

  it("not tracked person, no job or office, red edge for not signed in", () => {
    renderWithProviders(<PersonCard live person={person({ JobTitle: null, PresenceExempt: 1, status: { code: "not_tracked", label: "Not tracked" } })} onOpen={() => {}} onMark={() => {}} />);
    expect(screen.getAllByText("Not tracked").length).toBeGreaterThan(0);
    renderWithProviders(<PersonCard live person={person({ UserId: 6, status: { code: "not_signed_in", label: "Not signed in" }, counts: { overdue: 0 } })} onOpen={() => {}} onMark={() => {}} />);
    expect(screen.getByTestId("person-card-6").dataset.alert).toBe("true");
    expect(screen.getByTestId("person-card-5").dataset.alert).toBe("true"); // overdue 1
  });

  // Regression: a "-" job title showed as "- · Noida".
  it("drops a blank or dash job title from the role line", () => {
    renderWithProviders(<PersonCard live office="Noida" person={person({ UserId: 7, JobTitle: "-" })} onOpen={() => {}} onMark={() => {}} />);
    const card = screen.getByTestId("person-card-7");
    expect(card).toHaveTextContent("Noida");
    expect(card.textContent).not.toMatch(/-\s·/);
  });

  it("a past day says no sign-in, not no sign-in today", () => {
    renderWithProviders(<PersonCard live={false} person={person({ UserId: 8, FirstSignInAt: null, session: null, status: { code: "not_signed_in", label: "Not signed in" } })} onOpen={() => {}} onMark={() => {}} />);
    const card = screen.getByTestId("person-card-8");
    expect(card.textContent).toMatch(/no sign-in/i);
    expect(card.textContent).not.toMatch(/sign-in today/i);
  });

  // 2026-10-11: attention is a dot by the name, never a red card edge.
  it("needs attention shows a dot by the name and keeps a neutral edge", () => {
    renderWithProviders(<PersonCard live person={person({ UserId: 9, status: { code: "not_signed_in", label: "Not signed in" } })} onOpen={() => {}} onMark={() => {}} />);
    expect(screen.getByTestId("attention-9")).toHaveAccessibleName("Needs attention");
    const card = screen.getByTestId("person-card-9");
    expect(card.style.border).not.toMatch(/239, 68, 68|EF4444|FECACA|254, 202, 202/i);
  });
});
