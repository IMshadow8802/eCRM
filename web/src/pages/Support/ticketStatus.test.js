import { describe, it, expect } from "vitest";
import dayjs from "dayjs";

import {
  TICKET_PRESETS, presetParams, ticketsParamsToState,
  isActiveCode, isTerminalCode, statusTone, dueLabel,
} from "./ticketStatus";

const p = (s) => new URLSearchParams(s);

describe("status codes", () => {
  it("open + onhold are active; resolved, closed, rejected are terminal", () => {
    expect(isActiveCode("open")).toBe(true);
    expect(isActiveCode("onhold")).toBe(true);
    expect(isActiveCode("resolved")).toBe(false);
    expect(isTerminalCode("resolved")).toBe(true);
    expect(isTerminalCode("closed")).toBe(true);
    expect(isTerminalCode("rejected")).toBe(true);
    expect(isTerminalCode("open")).toBe(false);
    expect(isActiveCode(undefined)).toBe(false);
    expect(isTerminalCode(null)).toBe(false);
  });

  it("tones every code and falls back to default", () => {
    expect(statusTone("open")).toBe("info");
    expect(statusTone("onhold")).toBe("warning");
    expect(statusTone("resolved")).toBe("success");
    expect(statusTone("closed")).toBe("default");
    expect(statusTone("rejected")).toBe("error");
    expect(statusTone("anything")).toBe("default");
    expect(statusTone(undefined)).toBe("default");
  });
});

describe("presets", () => {
  it("lists the eight presets in order", () => {
    expect(TICKET_PRESETS.map((x) => x.value)).toEqual(["mine", "team", "unassigned", "overdue", "escalated", "onhold", "closed", "all"]);
  });

  // spec §4: presets map to fetchTickets params; "active" = open + onhold.
  it("maps every preset onto fetchTickets params", () => {
    expect(presetParams("mine", 7)).toEqual({ AssignedTo: 7, StatusCode: "active" });
    expect(presetParams("team")).toEqual({ StatusCode: "active" });
    expect(presetParams("unassigned")).toEqual({ Unassigned: 1, StatusCode: "active" });
    expect(presetParams("overdue")).toEqual({ Overdue: 1 });
    expect(presetParams("escalated")).toEqual({ Escalated: 1 });
    expect(presetParams("onhold")).toEqual({ StatusCode: "onhold" });
    expect(presetParams("closed")).toEqual({ StatusCode: "closed" });
    expect(presetParams("all")).toEqual({});
    expect(presetParams("nonsense")).toEqual({});
  });
});

describe("ticketsParamsToState", () => {
  it("seeds every id filter and the date range from the URL", () => {
    expect(ticketsParamsToState(p("StatusId=62&Priority=3&CategoryId=6&ChannelId=71&ProductId=1&AssignedTo=17&BranchId=2&from=2026-09-01&to=2026-09-16"))).toEqual({
      preset: "team",
      filters: { StatusId: 62, Priority: 3, CategoryId: 6, ChannelId: 71, ProductId: 1, AssignedTo: 17, BranchId: 2 },
      range: { from: "2026-09-01", to: "2026-09-16" },
    });
  });

  it("maps preset flags onto the tabs, a named preset winning", () => {
    expect(ticketsParamsToState(p("Overdue=1")).preset).toBe("overdue");
    expect(ticketsParamsToState(p("Escalated=true")).preset).toBe("escalated");
    expect(ticketsParamsToState(p("Unassigned=1")).preset).toBe("unassigned");
    expect(ticketsParamsToState(p("StatusCode=onhold")).preset).toBe("onhold");
    expect(ticketsParamsToState(p("StatusCode=closed")).preset).toBe("closed");
    expect(ticketsParamsToState(p("preset=mine&Overdue=1")).preset).toBe("mine");
    expect(ticketsParamsToState(p("preset=all")).preset).toBe("all");
    expect(ticketsParamsToState(p("preset=bogus")).preset).toBe("team");
    expect(ticketsParamsToState(p("")).preset).toBe("team");
  });

  it("drops anything that is not a positive integer or an ISO day", () => {
    expect(ticketsParamsToState(p("StatusId=abc&AssignedTo=-3&from=01/09/2026&to=2026-09-16"))).toEqual({
      preset: "team",
      filters: { StatusId: "", Priority: "", CategoryId: "", ChannelId: "", ProductId: "", AssignedTo: "", BranchId: "" },
      range: { from: "", to: "2026-09-16" },
    });
  });
});

describe("dueLabel", () => {
  const now = dayjs("2026-09-16T10:00:00");

  it.each([
    ["2026-09-16T13:00:00", 0, "in 3h"],
    ["2026-09-16T10:20:00", 0, "in 20m"],
    ["2026-09-18T09:00:00", 0, "in 47h"],
    ["2026-09-18T10:00:00", 0, "in 2d"],
    ["2026-09-14T10:00:00", 1, "2d overdue"],
    ["2026-09-16T07:00:00", true, "3h overdue"],
    ["2026-09-16T09:45:00", 1, "15m overdue"],
  ])("%s (overdue=%s) reads %s", (dueAt, isOverdue, out) => {
    expect(dueLabel(dueAt, isOverdue, now)).toBe(out);
  });

  it("shows the date for a past due date that is not overdue (a closed complaint)", () => {
    expect(dueLabel("2026-09-14T10:00:00", 0, now)).toBe("14-09-2026");
  });

  it("renders an em dash with no due date", () => {
    expect(dueLabel(null, 0, now)).toBe("—");
    expect(dueLabel(undefined, 1, now)).toBe("—");
  });
});
