import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import WorkCalendar from "./WorkCalendar";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const ok = (data = {}) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });

const DAYS = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ d, on: d >= 1 && d <= 5, start: "09:30", end: "18:30", breakStart: "13:00", breakEnd: "14:00" }));
let bodies;
let settings;

const seed = (calendars) => {
  bodies = {};
  settings = {
    settings: { LateGraceMin: 10, SessionBufferMin: 30, WarnPct: 80, NotifyNotSignedIn: 1, GoLiveDate: "2026-10-31T18:30:00.000Z" },
    calendars,
    holidays: [{ Id: 1, HolidayDate: "2026-11-08T18:30:00.000Z", Name: "Diwali", BranchId: null, BranchName: null }],
    tatPolicy: [{ Priority: "high", Minutes: 90 }],
  };
  const rec = (name) => http.post(`*/api/${name}`, async ({ request }) => { bodies[name] = await request.json(); return ok({ id: 1 }); });
  server.use(
    http.post("*/api/work/fetchWorkSettings", () => ok(settings)),
    http.post("*/api/users/fetchBranches", () => ok({ branches: [{ Id: 2, BranchName: "Mumbai", IsActive: 1 }] })),
    rec("work/saveCompanySetting"), rec("work/saveWorkCalendar"), rec("work/deleteWorkCalendar"),
    rec("work/saveHoliday"), rec("work/deleteHoliday"), rec("tat/saveTatPolicy"),
  );
};

const asEditor = (edit) =>
  useAuthStore.setState({
    isAuthenticated: true, token: null, user: { UserId: 1 }, API_BASE_URL: "https://x.test",
    access: { isAdmin: false, modules: { settings: { view: true, edit } } },
  });

const CALS = [
  { Id: 1, Name: "General", IsDefault: 1, UserCount: 3, DaysJson: DAYS },
  { Id: 2, Name: "Night", IsDefault: 0, UserCount: 2, DaysJson: DAYS },
  { Id: 3, Name: "Spare", IsDefault: 0, UserCount: 0, DaysJson: DAYS },
];

describe("WorkCalendar", () => {
  beforeEach(() => { seed(CALS); asEditor(true); });

  it("lists shifts as a table with hours summary, Default chip and people counts", async () => {
    seed([
      { Id: 1, Name: "General", IsDefault: 1, UserCount: 1, DaysJson: [1, 2, 3, 4, 5, 6].map((d) => ({ d, on: true, start: "09:00", end: "18:00", breakStart: "13:00", breakEnd: "14:00" })) },
      { Id: 2, Name: "Night", IsDefault: 0, UserCount: 2, DaysJson: [1, 2, 3, 4, 5].map((d) => ({ d, on: true, start: "21:00", end: "06:00" })) },
      { Id: 3, Name: "Mixed", IsDefault: 0, UserCount: 0, DaysJson: [{ d: 1, on: true, start: "09:00", end: "17:00" }, { d: 2, on: true, start: "10:00", end: "17:00" }, { d: 3, on: false, start: "10:00", end: "17:00" }] },
      { Id: 4, Name: "Off", IsDefault: 0, UserCount: 0, DaysJson: null },
    ]);
    renderWithProviders(<WorkCalendar />);
    const table = await screen.findByTestId("shifts-table");
    expect(within(table).getByRole("columnheader", { name: /Hours/ })).toBeInTheDocument();
    expect(within(table).getByText("Mon–Sat 09:00–18:00 · break 13:00–14:00")).toBeInTheDocument();
    expect(within(table).getByText("Mon–Fri 21:00–06:00")).toBeInTheDocument();
    expect(within(table).getByText("Mon 09:00–17:00; Tue 10:00–17:00")).toBeInTheDocument();
    expect(within(table).getByText("No working days")).toBeInTheDocument();
    expect(within(table).getByText("Default")).toBeInTheDocument();
    expect(within(table).getByText("1 person")).toBeInTheDocument();
    expect(within(table).getByText("2 people")).toBeInTheDocument();
    expect(within(table).getAllByText("Edit")).toHaveLength(4);
  });

  it("read-only users see the shifts table without actions", async () => {
    asEditor(false);
    renderWithProviders(<WorkCalendar />);
    const table = await screen.findByTestId("shifts-table");
    expect(within(table).queryByRole("columnheader", { name: /Actions/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit General" })).toBeNull();
  });

  it("the shift editor has column headers and groups the same warning across days", async () => {
    const user = userEvent.setup();
    seed([{ Id: 2, Name: "Night", IsDefault: 0, UserCount: 0, DaysJson: [1, 2, 3, 4, 5].map((d) => ({ d, on: true, start: "21:00", end: "06:00", breakStart: "01:00", breakEnd: "02:00" })) }]);
    renderWithProviders(<WorkCalendar />);
    await user.click(await screen.findByRole("button", { name: "Edit Night" }));
    const heads = within(screen.getByTestId("shift-day-headers"));
    for (const h of ["Day", "Working", "Start", "End", "Break start", "Break end"]) expect(heads.getByText(h)).toBeInTheDocument();
    const w = screen.getByTestId("shift-warnings");
    expect(w).toHaveTextContent("Night hours (21:00–06:00) on Mon–Fri — check the rules for women staff");
    expect(w.children).toHaveLength(1);
  });

  it("saves a shift with a break edit and sends the 7 days", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WorkCalendar />);
    await user.click(await screen.findByRole("button", { name: "Edit General" }));
    const brk = screen.getByLabelText("Monday Break start");
    await user.clear(brk);
    await user.type(brk, "12:30");
    await user.click(screen.getByRole("button", { name: "Save shift" }));
    await waitFor(() => expect(bodies["work/saveWorkCalendar"]).toBeDefined());
    const b = bodies["work/saveWorkCalendar"];
    expect(b).toMatchObject({ Id: 1, Name: "General", IsDefault: true });
    expect(b.DaysJson).toHaveLength(7);
    expect(b.DaysJson.find((d) => d.d === 1)).toMatchObject({ on: true, start: "09:30", breakStart: "12:30", breakEnd: "14:00" });
    expect(b.DaysJson.find((d) => d.d === 0).on).toBe(false);
  });

  it("creates a new shift and shows soft warnings without blocking", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WorkCalendar />);
    await user.click(await screen.findByRole("button", { name: "New shift" }));
    await user.type(screen.getByLabelText("Shift name"), "Late");
    const end = screen.getByLabelText("Monday End");
    await user.clear(end);
    await user.type(end, "21:30");
    expect(await screen.findByTestId("shift-warnings")).toHaveTextContent("> 9 hours on Mon");
    await user.click(screen.getByRole("button", { name: "Save shift" }));
    await waitFor(() => expect(bodies["work/saveWorkCalendar"]).toMatchObject({ Id: 0, Name: "Late", IsDefault: false }));
  });

  it("disables delete for the default shift and for a shift in use, deletes an unused one", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WorkCalendar />);
    expect(await screen.findByRole("button", { name: "Delete General" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete Night" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Delete Spare" }));
    await user.click(await screen.findByRole("button", { name: "Delete shift" }));
    await waitFor(() => expect(bodies["work/deleteWorkCalendar"]).toEqual({ Id: 3 }));
  });

  it("saves a holiday for all offices", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WorkCalendar />);
    await user.click(await screen.findByTestId("work-calendar-tabs-holidays"));
    const table = await screen.findByTestId("holidays-table");
    expect(within(table).getByText("Diwali")).toBeInTheDocument();
    expect(within(table).getByText("09 Nov 2026")).toBeInTheDocument();
    expect(within(table).getByText("All offices")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit Diwali" }));
    const name = screen.getByLabelText("Holiday name");
    await user.clear(name);
    await user.type(name, "Deepavali");
    await user.click(screen.getByRole("button", { name: "Save holiday" }));
    await waitFor(() => expect(bodies["work/saveHoliday"]).toEqual({ Id: 1, HolidayDate: "2026-11-09", Name: "Deepavali", BranchId: null }));
  });

  it("deletes a holiday", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WorkCalendar />);
    await user.click(await screen.findByTestId("work-calendar-tabs-holidays"));
    await user.click(await screen.findByRole("button", { name: "Delete Diwali" }));
    await user.click(await screen.findByRole("button", { name: "Delete holiday" }));
    await waitFor(() => expect(bodies["work/deleteHoliday"]).toEqual({ Id: 1 }));
  });

  it("saves rules and converts TAT hours to minutes", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WorkCalendar />);
    await user.click(await screen.findByTestId("work-calendar-tabs-rules"));
    const high = await screen.findByLabelText("High priority (hours)");
    expect(high).toHaveValue(1.5);
    await user.clear(high);
    await user.type(high, "2.5");
    await user.type(screen.getByLabelText("Low priority (hours)"), "24");
    await user.click(screen.getByRole("button", { name: "Save rules" }));
    await waitFor(() => expect(bodies["tat/saveTatPolicy"]).toBeDefined());
    expect(bodies["work/saveCompanySetting"]).toEqual({
      LateGraceMin: 10, SessionBufferMin: 30, WarnPct: 80, NotifyNotSignedIn: true, GoLiveDate: "2026-11-01",
    });
    expect(bodies["tat/saveTatPolicy"]).toEqual({ Items: [{ Priority: "high", Minutes: 150 }, { Priority: "low", Minutes: 1440 }] });
  });

  it("stops after a refused settings save", async () => {
    server.use(http.post("*/api/work/saveCompanySetting", () => HttpResponse.json({ success: false, message: "Late grace must be 0 to 120 minutes" }, { status: 400 })));
    const user = userEvent.setup();
    renderWithProviders(<WorkCalendar />);
    await user.click(await screen.findByTestId("work-calendar-tabs-rules"));
    await user.click(await screen.findByRole("button", { name: "Save rules" }));
    expect(await screen.findByText("Late grace must be 0 to 120 minutes")).toBeInTheDocument();
    expect(bodies["tat/saveTatPolicy"]).toBeUndefined();
  });

  it("shows no Save or edit controls without settings edit", async () => {
    asEditor(false);
    const user = userEvent.setup();
    renderWithProviders(<WorkCalendar />);
    expect(await screen.findByText("General")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New shift" })).not.toBeInTheDocument();
    await user.click(screen.getByTestId("work-calendar-tabs-holidays"));
    expect(screen.queryByRole("button", { name: "New holiday" })).not.toBeInTheDocument();
    await user.click(screen.getByTestId("work-calendar-tabs-rules"));
    expect(await screen.findByLabelText("Count as late after (minutes)")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save rules" })).not.toBeInTheDocument();
  });
});
