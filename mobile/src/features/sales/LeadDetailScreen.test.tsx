import { Linking } from "react-native";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import { RECORD_GONE_MESSAGE } from "../../api/errors";
import { fetchAttachments } from "../../api/attachmentQueries";
import { fetchCalls, logCall } from "../../api/callQueries";
import { fetchLookups, LOOKUP_KIND } from "../../api/configQueries";
import { completeFollowUp, scheduleFollowUp, skipFollowUp } from "../../api/followupQueries";
import { convertLead, fetchLeadDetail, setLeadStatus, transferLead } from "../../api/leadQueries";
import { fetchProducts } from "../../api/productQueries";
import { fetchAssignableUsers, fetchUserDirectory } from "../../api/userQueries";
import type { AssignableUser, FollowUp, Lead, LeadDetail, Lookup } from "../../types/api";
import type { BarAction } from "../../ui";
import { envelope, followUp as fixtureFollowUp, lead as fixtureLead, localDay, serverError } from "../../test/fixtures";
import { spySheets } from "../../test/sheets";
import { flat } from "../../test/style";
import { PHONE, setWindow, TABLET } from "../../test/window";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { colors } from "../../theme";
import { dueTitle } from "./leadHelpers";
import LeadDetailScreen from "./LeadDetailScreen";
import { pickTime } from "../../test/pickers";

jest.mock("../../api/leadQueries");
jest.mock("../../api/followupQueries");
jest.mock("../../api/callQueries");
jest.mock("../../api/configQueries");
jest.mock("../../api/userQueries");
jest.mock("../../api/productQueries");
jest.mock("../../api/attachmentQueries");

// The Shell draws the action bar from what the screen publishes; outside a
// navigator there is no Shell, so this stand-in records the published actions
// and answers `inBand` the way the Shell does (the rail is up from 600 dp).
const mockBar: { actions: BarAction[] } = { actions: [] };
jest.mock("../../navigation/Shell", () => ({
  useActionBar: (actions: BarAction[]) => {
    mockBar.actions = actions;
    const { Dimensions } = jest.requireActual("react-native");
    return { inBand: Dimensions.get("window").width >= 600 };
  },
}));
const bar = () => mockBar.actions.map((a) => `${a.label}${a.main ? " (main)" : ""}${a.disabled ? " (off)" : ""}`);
const pressBar = (label: string) =>
  act(async () => {
    mockBar.actions.find((a) => a.label === label)!.onPress();
  });

/** The row menu renders after the follow-up sheets, whose title and button share its words. */
const menuItem = (label: string) => screen.getAllByText(label).at(-1)!;
/** Reschedule: [0] the sheet title, [1] its submit, [2] the row menu. */
const rescheduleSubmit = () => screen.getAllByText("Reschedule")[1]!;

const FULL = { view: true, add: true, edit: true, delete: true, reach: "Company" as const };

const lookup = (Id: number, Kind: string, Value: string, Code: string | null = null): Lookup => ({
  Id, CompId: 1, Kind, Value, Code, SortOrder: Id, IsActive: true,
});
const STATUSES = [
  lookup(1, LOOKUP_KIND.leadStatus, "New", "open"),
  lookup(2, LOOKUP_KIND.leadStatus, "Qualified", "qualified"),
  lookup(3, LOOKUP_KIND.leadStatus, "Won", "converted"),
  lookup(4, LOOKUP_KIND.leadStatus, "Lost", "lost"),
];
const LOOKUPS: Record<string, Lookup[]> = {
  [LOOKUP_KIND.leadStatus]: STATUSES,
  [LOOKUP_KIND.lostReason]: [lookup(10, LOOKUP_KIND.lostReason, "Price too high")],
  [LOOKUP_KIND.transferReason]: [lookup(30, LOOKUP_KIND.transferReason, "On leave")],
  [LOOKUP_KIND.callOutcome]: [lookup(40, LOOKUP_KIND.callOutcome, "Reached")],
};

const user = (Id: number, FullName: string, JobTitle: string, BranchId = 1): AssignableUser => ({
  Id, FullName, Avatar: null, JobTitle, BranchId, BranchName: BranchId === 1 ? "Head Office" : "Surat Office", ReportsTo: null,
});
const ravi = user(5, "Ravi Mehta", "Manager");
const priya = user(9, "Priya Shah", "Sales");

// Ravi (5) owns the lead; the follow-up is due far ahead, so never overdue by accident.
const lead = (patch: Partial<Lead> = {}): Lead =>
  fixtureLead({
    Id: 11, BranchId: 1, BranchName: "Head Office", Name: "Anil Kumar", Company: "Sharma Traders",
    MobileNo: "9825012345", AltMobile: null, Email: "anil@sharma.in", SourceId: 1, SourceName: "Walk-in",
    PartnerName: null, ProductId: 1, ProductName: "Solar 5kW", StatusId: 2, StatusName: "Qualified",
    StatusCode: "qualified", OwnerId: 5, OwnerName: "Ravi Mehta", EstValue: 120000, Remarks: null,
    NextFollowupDate: null, IsOverdue: false, WonAt: null, WonValue: null, CreatedAt: "2026-10-26T10:00:00",
    CanEdit: true, CanReassign: true, SendBackToId: null, SendBackToName: null,
    ...patch,
  });

const followUp = (patch: Partial<FollowUp> = {}): FollowUp =>
  fixtureFollowUp({
    Id: 70, LeadId: 11, Type: "call", DueAt: "2099-01-01T11:00:00", Status: "open", AssignedTo: 5,
    AssignedToName: "Ravi Mehta", DoneAt: null, DoneByName: null, Outcome: null, Remarks: null, IsOverdue: false,
    CreatedBy: 42, LeadName: "Anil Kumar",
    ...patch,
  });

const detail = (row: Lead | null = lead(), extra: Partial<LeadDetail> = {}): LeadDetail => ({
  lead: row, fields: [], activity: [], followups: [], assignments: [], ...extra,
});

const mount = (navigation = makeNavigation<"LeadDetail">()) =>
  renderWithProviders(<LeadDetailScreen navigation={navigation} route={makeRoute("LeadDetail", { leadId: 11 })} />);

/** The band, plus the lookups and users every sheet is built from. */
const loaded = async () => {
  expect(await screen.findByRole("header", { name: "Anil Kumar" })).toBeOnTheScreen();
  await screen.findByText("On leave");
  await screen.findAllByText("Reached");
};

beforeEach(() => {
  setWindow(...PHONE);
  mockBar.actions = [];
  seedAuth({ UserId: 42, access: { modules: { leads: FULL } } });
  jest.mocked(fetchAttachments).mockResolvedValue([]);
  jest.mocked(fetchLeadDetail).mockResolvedValue(detail());
  jest.mocked(fetchLookups).mockImplementation(async ({ Kind }) => LOOKUPS[Kind] ?? []);
  jest.mocked(fetchAssignableUsers).mockResolvedValue([ravi, priya]);
  jest.mocked(fetchProducts).mockResolvedValue([]);
  jest.mocked(fetchUserDirectory).mockResolvedValue([{ Id: 42, FullName: "Ayush Mishra", Username: null, Avatar: null, JobTitle: null }]);
  jest.mocked(fetchCalls).mockResolvedValue([]);
  const ok = envelope(null);
  jest.mocked(setLeadStatus).mockResolvedValue(ok);
  jest.mocked(convertLead).mockResolvedValue(ok);
  jest.mocked(transferLead).mockResolvedValue(ok);
  jest.mocked(scheduleFollowUp).mockResolvedValue(envelope({ Id: 1 }));
  jest.mocked(completeFollowUp).mockResolvedValue(envelope({ Id: 70, NextId: null }));
  jest.mocked(skipFollowUp).mockResolvedValue(envelope({ Id: 70 }));
  jest.mocked(logCall).mockResolvedValue(envelope({ Id: 1 }));
});

describe("when the lead cannot be shown", () => {
  it("a 404 says it is not available and back still works", async () => {
    jest.mocked(fetchLeadDetail).mockRejectedValue(serverError(404, "Not found"));
    const navigation = makeNavigation<"LeadDetail">();
    await mount(navigation);
    expect(await screen.findByText("Lead not available")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Go back" }));
    expect(navigation.goBack).toHaveBeenCalled();
    expect(mockBar.actions).toEqual([]);
  });

  // X404: 404 alone means gone; a 403 is a refusal and reads as a load failure.
  it("a 403 is not 'not available'", async () => {
    jest.mocked(fetchLeadDetail).mockRejectedValue(serverError(403, "No"));
    await mount();
    expect(await screen.findByText("The lead could not be loaded. Check your connection and try again.")).toBeOnTheScreen();
    expect(screen.queryByText("Lead not available")).toBeNull();
  });

  it("a resolved detail with no lead row is treated the same way", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(null));
    await mount();
    expect(await screen.findByText("Lead not available")).toBeOnTheScreen();
  });

  it("a server fault offers a retry that refetches", async () => {
    jest.mocked(fetchLeadDetail).mockRejectedValueOnce(serverError(500, "boom"));
    await mount();
    expect(await screen.findByText("The lead could not be loaded. Check your connection and try again.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("header", { name: "Anil Kumar" })).toBeOnTheScreen();
  });

  it("loading shows skeleton rows under the band", async () => {
    jest.mocked(fetchLeadDetail).mockReturnValue(new Promise(() => {}));
    await mount();
    expect(screen.getByLabelText("Loading")).toBeOnTheScreen();
  });
});

describe("E 15 band and contact card", () => {
  it("name, company · product, est. value, the status chip and Change status", async () => {
    await mount();
    await loaded();
    expect(screen.getByText("Sharma Traders · Solar 5kW")).toBeOnTheScreen();
    expect(screen.getByText("Est. value")).toBeOnTheScreen();
    expect(screen.getByText("₹1,20,000")).toBeOnTheScreen();
    expect(screen.getAllByText("Qualified").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Change status" })).toBeOnTheScreen();
    // Mobile spaced as people say it; owner and source on the card.
    expect(screen.getByText("98250 12345")).toBeOnTheScreen();
    expect(screen.getByText("Ravi Mehta")).toBeOnTheScreen();
    expect(screen.getByText("Walk-in")).toBeOnTheScreen();
  });

  it("Call dials; Message tries WhatsApp, then SMS (G30); a phone with neither says so", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await mount();
    await loaded();
    await fireEvent.press(screen.getByRole("button", { name: "Call" }));
    expect(open).toHaveBeenCalledWith("tel:9825012345");
    await fireEvent.press(screen.getByRole("button", { name: "Message" }));
    expect(open).toHaveBeenCalledWith("whatsapp://send?phone=919825012345");

    open.mockReset();
    open.mockRejectedValueOnce(new Error("no whatsapp")).mockResolvedValueOnce(true);
    await fireEvent.press(screen.getByRole("button", { name: "Message" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("sms:9825012345"));

    open.mockReset();
    open.mockRejectedValue(new Error("nothing"));
    await fireEvent.press(screen.getByRole("button", { name: "Message" }));
    expect(await screen.findByText("Can't open messaging on this device")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Call" }));
    expect(await screen.findByText("Can't open the dialer on this device")).toBeOnTheScreen();
    open.mockRestore();
  });

  it("no mobile: no call or message buttons, and the bar's are off", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead({ MobileNo: null, EstValue: null, Company: null, ProductName: null })));
    await mount();
    await loaded();
    expect(screen.queryByRole("button", { name: "Call" })).toBeNull();
    expect(screen.queryByText("Est. value")).toBeNull();
    expect(bar()).toEqual(["Call (off)", "Message (off)", "Log follow-up (main)", "Status", "Reassign"]);
  });
});

describe("the action bar", () => {
  it("Call · Message · Log follow-up (main) · Status · Reassign", async () => {
    await mount();
    await loaded();
    expect(bar()).toEqual(["Call", "Message", "Log follow-up (main)", "Status", "Reassign"]);
  });

  it("Log follow-up completes the next open one: remarks required, a call defaults to out and books the next", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead(), { followups: [followUp()] }));
    const { present } = spySheets();
    await mount();
    await loaded();
    present.mockClear();
    await pressBar("Log follow-up");
    expect(present).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Log the call")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Mark done"));
    expect(completeFollowUp).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByPlaceholderText("What was discussed — the next person reads this"), "Spoke to him");
    await fireEvent.changeText(screen.getByPlaceholderText("Call minutes"), "2.6");
    // Done's "Next follow-up" chips render first.
    await fireEvent.press(screen.getAllByRole("radio", { name: "Tomorrow" })[0]!);
    await fireEvent.press(screen.getByText("Mark done"));
    await waitFor(() =>
      expect(completeFollowUp).toHaveBeenCalledWith(
        { Id: 70, Remarks: "Spoke to him", OutcomeId: null, Direction: "out", Duration: 3, NextType: "call", NextDueAt: localDay(1) },
        expect.anything(),
      ),
    );
  });

  it("a visit logs no direction, minutes or next; a refusal keeps the sheet", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead(), { followups: [followUp({ Type: "visit" })] }));
    jest.mocked(completeFollowUp).mockRejectedValueOnce(serverError(400, "Already done"));
    const { dismiss } = spySheets();
    await mount();
    await loaded();
    await pressBar("Log follow-up");
    await fireEvent.changeText(screen.getByPlaceholderText("What was discussed — the next person reads this"), "Met");
    dismiss.mockClear();
    await fireEvent.press(screen.getByText("Mark done"));
    expect(await screen.findByText("Already done")).toBeOnTheScreen();
    expect(dismiss).not.toHaveBeenCalled();
    expect(completeFollowUp).toHaveBeenCalledWith(
      { Id: 70, Remarks: "Met", OutcomeId: null, Direction: null, Duration: null, NextType: null, NextDueAt: null },
      expect.anything(),
    );
  });

  it("with nothing open, Log follow-up schedules one: a type and a day, the local date", async () => {
    await mount();
    await loaded();
    await pressBar("Log follow-up");
    await fireEvent.press(screen.getByText("Add follow-up"));
    expect(scheduleFollowUp).not.toHaveBeenCalled();
    await fireEvent.press(screen.getAllByRole("radio", { name: "Visit" })[0]!);
    // Schedule's "When" row is the third Tomorrow: the follow-up sheets (Done's
    // "Next follow-up", Reschedule's "New day") render before it.
    await fireEvent.press(screen.getAllByRole("radio", { name: "Tomorrow" })[2]!);
    await fireEvent.press(screen.getByText("Add follow-up"));
    await waitFor(() =>
      expect(scheduleFollowUp).toHaveBeenCalledWith({ LeadId: 11, Type: "visit", DueAt: localDay(1) }, expect.anything()),
    );
  });

  it("schedule with a time books the day at that time", async () => {
    await mount();
    await loaded();
    await pressBar("Log follow-up");
    await fireEvent.press(screen.getAllByRole("radio", { name: "Visit" })[0]!);
    await fireEvent.press(screen.getAllByRole("radio", { name: "Tomorrow" })[2]!);
    await fireEvent.press(screen.getByText("Add a time (optional)"));
    await pickTime("12:30");
    await fireEvent.press(screen.getByText("Add follow-up"));
    await waitFor(() =>
      expect(scheduleFollowUp).toHaveBeenCalledWith({ LeadId: 11, Type: "visit", DueAt: `${localDay(1)}T12:30` }, expect.anything()),
    );
  });

  it("a refused schedule shows the sentence in the sheet", async () => {
    jest.mocked(scheduleFollowUp).mockRejectedValue(serverError(400, "Due date is in the past"));
    await mount();
    await loaded();
    await pressBar("Log follow-up");
    await fireEvent.press(screen.getAllByRole("radio", { name: "Call" })[0]!);
    await fireEvent.press(screen.getAllByRole("radio", { name: "Today" })[2]!);
    await fireEvent.press(screen.getByText("Add follow-up"));
    expect(await screen.findByText("Due date is in the past")).toBeOnTheScreen();
  });

  it("Status opens the status sheet; Reassign the per-lead pick list (the person it is with left out)", async () => {
    const { present } = spySheets();
    await mount();
    await loaded();
    present.mockClear();
    await pressBar("Status");
    await pressBar("Reassign");
    expect(present).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Anil Kumar · now Qualified")).toBeOnTheScreen();
    await waitFor(() => expect(fetchAssignableUsers).toHaveBeenCalledWith({ Module: "leads", RecordId: 11 }));
    expect(await screen.findByText("Sales · Head Office")).toBeOnTheScreen();
    expect(screen.queryByText("Manager · Head Office")).toBeNull();
  });
});

describe("status (E 25)", () => {
  it("a plain status posts setLeadStatus and refreshes the lead, the lists and the queue", async () => {
    const { queryClient } = await mount();
    await loaded();
    const spy = jest.spyOn(queryClient, "invalidateQueries");
    await fireEvent.press(screen.getByRole("radio", { name: "New" }));
    await fireEvent.press(screen.getByText("Save · mark new"));
    await waitFor(() =>
      expect(setLeadStatus).toHaveBeenCalledWith({ LeadId: 11, StatusId: 1, LostReasonId: null }, expect.anything()),
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ["lead", 11] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["leads"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["followups"] });
  });

  it("Lost sends its reason; a refusal shows in the sheet", async () => {
    jest.mocked(setLeadStatus).mockRejectedValueOnce(serverError(400, "Lead is locked"));
    await mount();
    await loaded();
    await fireEvent.press(screen.getByRole("radio", { name: "Lost" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Price too high" }));
    await fireEvent.press(screen.getByText("Save · mark lost"));
    expect(await screen.findByText("Lead is locked")).toBeOnTheScreen();
    expect(setLeadStatus).toHaveBeenCalledWith({ LeadId: 11, StatusId: 4, LostReasonId: 10 }, expect.anything());
  });

  it("Won converts with the value — setLeadStatus is never asked for converted", async () => {
    await mount();
    await loaded();
    await fireEvent.press(screen.getByRole("radio", { name: "Won" }));
    await fireEvent.changeText(screen.getByPlaceholderText("Amount in rupees"), "50,000");
    await fireEvent.press(screen.getByText("Save · mark won"));
    await waitFor(() =>
      expect(convertLead).toHaveBeenCalledWith({ LeadId: 11, WonValue: 50000, Remarks: null }, expect.anything()),
    );
    expect(setLeadStatus).not.toHaveBeenCalled();
  });

  it("a refused win shows the server's sentence", async () => {
    jest.mocked(convertLead).mockRejectedValue(serverError(400, "Quotation pending"));
    await mount();
    await loaded();
    await fireEvent.press(screen.getByRole("radio", { name: "Won" }));
    await fireEvent.changeText(screen.getByPlaceholderText("Amount in rupees"), "1");
    await fireEvent.press(screen.getByText("Save · mark won"));
    expect(await screen.findByText("Quotation pending")).toBeOnTheScreen();
  });
});

describe("follow-ups tab", () => {
  it("opens on Follow-ups with the open count; the next one is the butter card with who planned it (G18)", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(
      detail(lead(), {
        followups: [
          followUp({ Remarks: "Share the revised quote" }),
          followUp({ Id: 71, Type: "visit", DueAt: "2099-01-03T15:00:00", Remarks: "Roof survey" }),
          followUp({ Id: 72, Status: "done", DoneAt: "2026-10-29T09:00:00", Remarks: "Sent brochure" }),
          followUp({ Id: 73, Status: "skipped", Remarks: null, Type: "meeting" }),
        ],
      }),
    );
    await mount();
    await loaded();
    // E counts every follow-up on the lead, open or not.
    expect(screen.getByRole("tab", { name: "Follow-ups, 4" }).props.accessibilityState).toEqual({ selected: true });
    const card = screen.getByTestId("next-followup");
    expect(flat(card).backgroundColor).toBe(colors.followUpTint);
    expect(screen.getByText("Thu, 1 Jan · 11:00 am")).toBeOnTheScreen();
    expect(screen.getByText(/^Call · in \d+ d · planned by Ayush Mishra$/)).toBeOnTheScreen();
    expect(screen.getByText("Share the revised quote")).toBeOnTheScreen();
    expect(screen.getByText("Visit · Sat, 3 Jan · 3:00 pm")).toBeOnTheScreen();
    expect(screen.getByText("Call · Thu, 29 Oct · done")).toBeOnTheScreen();
    expect(flat(screen.getByText("Sent brochure")).color).toBe(colors.textSecondary);
    expect(within(screen.getByTestId("followup-73")).getByText("Meeting")).toBeOnTheScreen();
  });

  it("an overdue next one says so in red", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead(), { followups: [followUp({ IsOverdue: true, CreatedBy: null })] }));
    await mount();
    await loaded();
    expect(flat(screen.getByText("Call · overdue")).color).toBe(colors.dangerText);
  });

  it("a row opens Mark done / Reschedule / Skip; reschedule books first (same type, assignee, time of day), then skips", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(
      detail(lead(), {
        followups: [followUp(), followUp({ Id: 71, Type: "visit", Remarks: "Roof survey", AssignedTo: 9, DueAt: "2099-01-03T15:30:00" })],
      }),
    );
    await mount();
    await loaded();
    await fireEvent.press(screen.getByTestId("followup-71"));
    await fireEvent.press(menuItem("Reschedule"));
    await fireEvent.press(screen.getAllByRole("radio", { name: "In 3 days" })[1]!);
    await fireEvent.changeText(screen.getByPlaceholderText("Why it is moving"), "Client away");
    await fireEvent.press(rescheduleSubmit());
    await waitFor(() => expect(skipFollowUp).toHaveBeenCalled());
    expect(scheduleFollowUp).toHaveBeenCalledWith({ LeadId: 11, Type: "visit", DueAt: `${localDay(3)}T15:30`, AssignedTo: 9 });
    // The remark names the booked day and time ("Tue, 17 Nov · 3:30 pm").
    expect(skipFollowUp).toHaveBeenCalledWith({ Id: 71, Remarks: `Rescheduled to ${dueTitle(`${localDay(3)}T15:30`)}: Client away` });
    // The new one is booked before the old one is closed.
    expect(jest.mocked(scheduleFollowUp).mock.invocationCallOrder[0]!).toBeLessThan(jest.mocked(skipFollowUp).mock.invocationCallOrder[0]!);
  });

  it("a reschedule whose booking fails leaves the old one alone and shows the server's sentence", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead(), { followups: [followUp()] }));
    jest.mocked(scheduleFollowUp).mockRejectedValue(serverError(400, "Due date is in the past"));
    await mount();
    await loaded();
    await fireEvent.press(screen.getByTestId("next-followup"));
    await fireEvent.press(menuItem("Reschedule"));
    await fireEvent.press(screen.getAllByRole("radio", { name: "Tomorrow" })[1]!);
    await fireEvent.changeText(screen.getByPlaceholderText("Why it is moving"), "x");
    await fireEvent.press(rescheduleSubmit());
    expect(await screen.findByText("Due date is in the past")).toBeOnTheScreen();
    expect(skipFollowUp).not.toHaveBeenCalled();
  });

  it("a reschedule whose skip fails after booking says the old one is still open", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead(), { followups: [followUp()] }));
    jest.mocked(skipFollowUp).mockRejectedValue(serverError(400, "nope"));
    await mount();
    await loaded();
    await fireEvent.press(screen.getByTestId("next-followup"));
    await fireEvent.press(menuItem("Reschedule"));
    await fireEvent.press(screen.getAllByRole("radio", { name: "Tomorrow" })[1]!);
    await fireEvent.changeText(screen.getByPlaceholderText("Why it is moving"), "x");
    await fireEvent.press(rescheduleSubmit());
    expect(await screen.findByText("Booked the new follow-up, but the old one is still open — skip it from the lead.")).toBeOnTheScreen();
    // The old 11:00 rides along as the prefilled time.
    expect(scheduleFollowUp).toHaveBeenCalledWith({ LeadId: 11, Type: "call", DueAt: `${localDay(1)}T11:00`, AssignedTo: 5 });
  });

  it("retrying a reschedule after the skip failed retries only the skip — never books twice", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead(), { followups: [followUp()] }));
    jest.mocked(skipFollowUp).mockRejectedValueOnce(serverError(400, "nope"));
    await mount();
    await loaded();
    await fireEvent.press(screen.getByTestId("next-followup"));
    await fireEvent.press(menuItem("Reschedule"));
    await fireEvent.press(screen.getAllByRole("radio", { name: "Tomorrow" })[1]!);
    await fireEvent.changeText(screen.getByPlaceholderText("Why it is moving"), "x");
    await fireEvent.press(rescheduleSubmit());
    expect(await screen.findByText("Booked the new follow-up, but the old one is still open — skip it from the lead.")).toBeOnTheScreen();
    await fireEvent.press(rescheduleSubmit());
    await waitFor(() => expect(skipFollowUp).toHaveBeenCalledTimes(2));
    expect(scheduleFollowUp).toHaveBeenCalledTimes(1);
  });

  it("skip needs remarks, then sends them", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead(), { followups: [followUp()] }));
    await mount();
    await loaded();
    await fireEvent.press(screen.getByTestId("next-followup"));
    await fireEvent.press(menuItem("Skip"));
    // The skip sheet renders before the ⋮ menu, which also offers "Skip follow-up".
    await fireEvent.press(screen.getAllByText("Skip follow-up")[0]!);
    expect(skipFollowUp).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByPlaceholderText("Why it is not happening"), "Closed shop");
    await fireEvent.press(screen.getAllByText("Skip follow-up")[0]!);
    await waitFor(() => expect(skipFollowUp).toHaveBeenCalledWith({ Id: 70, Remarks: "Closed shop" }, expect.anything()));
  });

  it("no follow-ups says so", async () => {
    await mount();
    await loaded();
    expect(screen.getByText("No follow-ups yet.")).toBeOnTheScreen();
  });
});

describe("the ⋮ menu", () => {
  it("logs a call through LogCallSheet — no Then step on a lead", async () => {
    await mount();
    await loaded();
    expect(screen.getByText("Log a call")).toBeOnTheScreen();
    expect(screen.queryByText("Then")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "More duration" }));
    await fireEvent.changeText(screen.getByTestId("logcall-notes"), " Asked for a quote ");
    await fireEvent.press(screen.getByText("Save call"));
    await waitFor(() =>
      expect(logCall).toHaveBeenCalledWith(
        { LeadId: 11, Direction: "out", OutcomeId: null, Notes: "Asked for a quote", Duration: 2 },
        expect.anything(),
      ),
    );
  });

  it("a refused call (403) shows the sentence in the sheet and stays on the lead", async () => {
    jest.mocked(logCall).mockRejectedValue(serverError(403, "Not yours"));
    const navigation = makeNavigation<"LeadDetail">();
    await mount(navigation);
    await loaded();
    await fireEvent.changeText(screen.getByTestId("logcall-notes"), "x");
    await fireEvent.press(screen.getByText("Save call"));
    expect(await screen.findByText("Not yours")).toBeOnTheScreen();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it("a call on a lead that has gone (404) leaves the record and says so", async () => {
    jest.mocked(logCall).mockRejectedValue(serverError(404, "Not found"));
    const navigation = makeNavigation<"LeadDetail">();
    await mount(navigation);
    await loaded();
    await fireEvent.changeText(screen.getByTestId("logcall-notes"), "x");
    await fireEvent.press(screen.getByText("Save call"));
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(await screen.findByText(RECORD_GONE_MESSAGE)).toBeOnTheScreen();
  });

  it("Files goes to the Details tab, where the attachments are", async () => {
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Files"));
    await waitFor(() => expect(fetchAttachments).toHaveBeenCalledWith({ Entity: "lead", EntityId: 11 }));
    expect(screen.getByRole("tab", { name: "Details" }).props.accessibilityState).toEqual({ selected: true });
    expect(await screen.findByLabelText("Add a file")).toBeOnTheScreen();
  });

  it("Skip follow-up is offered only while one is open", async () => {
    await mount();
    await loaded();
    expect(screen.queryByText("It is not happening")).toBeNull();
  });

  it("Edit opens the form for this lead", async () => {
    const navigation = makeNavigation<"LeadDetail">();
    await mount(navigation);
    await loaded();
    await fireEvent.press(screen.getByRole("button", { name: "Edit lead" }));
    expect(navigation.navigate).toHaveBeenCalledWith("LeadForm", { leadId: 11 });
  });
});

describe("reassign and send back", () => {
  const amit: AssignableUser = { ...user(12, "Amit Singh", "Sales", 2), GroupRank: 3, AwayToday: true };
  const nitin: AssignableUser = { ...user(14, "Nitin Verma", "Sales"), GroupRank: 1, IsGiver: true };

  const openReassign = async (people: AssignableUser[] = [ravi, { ...priya, GroupRank: 2 }, amit, nitin]) => {
    jest.mocked(fetchAssignableUsers).mockResolvedValue(people);
    await pressBar("Reassign");
    await screen.findByText("Priya Shah");
  };
  const fillAndSubmit = async (name = "Priya Shah") => {
    await fireEvent.press(screen.getByText(name));
    await fireEvent.press(screen.getByText("On leave"));
    await fireEvent.changeText(screen.getByTestId("reassign-remarks"), "covering");
    await fireEvent.press(screen.getByText(`Reassign to ${name.split(" ")[0]}`));
  };

  it("never says Transfer or Owner on the lead", async () => {
    await mount();
    await loaded();
    await openReassign();
    expect(screen.queryAllByText(/transfer|owner/i)).toEqual([]);
    expect(screen.getByText("Reassign lead")).toBeOnTheScreen();
    expect(screen.getByText("Anil Kumar · now with Ravi Mehta")).toBeOnTheScreen();
  });

  it("groups the people, marks Away today and the giver, and search narrows the list", async () => {
    await mount();
    await loaded();
    await openReassign();
    for (const t of ["Your manager and team", "Your office", "Other offices", "Away today", "Gave it to you"]) {
      expect(screen.getByText(t)).toBeOnTheScreen();
    }
    await fireEvent.changeText(screen.getByTestId("reassign-search"), "amit");
    expect(screen.queryByText("Priya Shah")).toBeNull();
    expect(screen.queryByText("Your office")).toBeNull();
    expect(screen.getByText("Amit Singh")).toBeOnTheScreen();
  });

  it("needs a reason and remarks; success posts no office, drops the cached lead, goes back and toasts", async () => {
    const navigation = makeNavigation<"LeadDetail">();
    const { queryClient } = await mount(navigation);
    const remove = jest.spyOn(queryClient, "removeQueries");
    await loaded();
    await openReassign();
    await fireEvent.press(screen.getByText("Priya Shah"));
    await fireEvent.press(screen.getByText("Reassign to Priya"));
    expect(transferLead).not.toHaveBeenCalled();
    expect(screen.getByText("Pick a reason.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("On leave"));
    await fireEvent.changeText(screen.getByTestId("reassign-remarks"), "covering");
    await fireEvent.press(screen.getByText("Reassign to Priya"));
    await waitFor(() =>
      expect(transferLead).toHaveBeenCalledWith(
        { LeadId: 11, ToUserId: 9, ToBranchId: null, ReasonId: 30, Remarks: "covering" },
        expect.anything(),
      ),
    );
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(remove).toHaveBeenCalledWith({ queryKey: ["lead", 11] });
    expect(await screen.findByText("Reassigned to Priya Shah")).toBeOnTheScreen();
  });

  it("with no reasons configured the sheet says so and cannot be sent", async () => {
    jest.mocked(fetchLookups).mockImplementation(async ({ Kind }) => (Kind === LOOKUP_KIND.transferReason ? [] : (LOOKUPS[Kind] ?? [])));
    await mount();
    expect(await screen.findByText("No reasons are set up. Add them on the web first.")).toBeOnTheScreen();
  });

  it("a refused reassign (403) shows the server's sentence, refetches and stays", async () => {
    jest.mocked(transferLead).mockRejectedValue(serverError(403, "Not in your team"));
    const navigation = makeNavigation<"LeadDetail">();
    await mount(navigation);
    await loaded();
    await openReassign();
    const calls = jest.mocked(fetchLeadDetail).mock.calls.length;
    await fillAndSubmit();
    expect(await screen.findByText("Not in your team")).toBeOnTheScreen();
    await waitFor(() => expect(jest.mocked(fetchLeadDetail).mock.calls.length).toBeGreaterThan(calls));
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it("a reassign on a lead someone else moved (404) leaves and says it is no longer with you", async () => {
    jest.mocked(transferLead).mockRejectedValue(serverError(404, "Not found"));
    const navigation = makeNavigation<"LeadDetail">();
    await mount(navigation);
    await loaded();
    await openReassign();
    await fillAndSubmit();
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(await screen.findByText(RECORD_GONE_MESSAGE)).toBeOnTheScreen();
  });

  it("nobody to pick says ask a manager", async () => {
    await mount();
    await loaded();
    jest.mocked(fetchAssignableUsers).mockResolvedValue([ravi]);
    await pressBar("Reassign");
    expect(await screen.findByText("Nobody can take this. Ask a manager.")).toBeOnTheScreen();
  });

  it("Reassign is not offered on a lost lead for an Own-reach user (CanReassign false)", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(
      detail(lead({ StatusId: 4, StatusName: "Lost", StatusCode: "lost", CanReassign: false })),
    );
    await mount();
    expect(await screen.findByRole("header", { name: "Anil Kumar" })).toBeOnTheScreen();
    await screen.findAllByText("Reached");
    expect(bar()).toEqual(["Call", "Message", "Log follow-up (main)", "Status"]);
    expect(screen.queryByText("Reassign lead")).toBeNull();
  });

  it("CanEdit false hides every write action", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead({ CanEdit: false })));
    await mount();
    expect(await screen.findByRole("header", { name: "Anil Kumar" })).toBeOnTheScreen();
    expect(bar()).toEqual(["Call", "Message"]);
    expect(screen.queryByLabelText("Lead actions")).toBeNull();
  });

  // Task 26 review Important 1: a follow-up answers for itself (CanAct), not through the lead.
  it("a follow-up delegated to me (CanAct) stays actionable on a lead I cannot edit", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead({ CanEdit: false }), { followups: [followUp({ CanAct: true })] }));
    await mount();
    expect(await screen.findByRole("header", { name: "Anil Kumar" })).toBeOnTheScreen();
    expect(bar()).toEqual(["Call", "Message"]);
    const { present } = spySheets();
    await fireEvent.press(screen.getByTestId("next-followup"));
    expect(present).toHaveBeenCalledTimes(1);
    present.mockClear();
    await fireEvent.press(menuItem("Mark done"));
    // The done sheet opens (it is mounted for the grant, not for the lead).
    expect(present).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Log the call")).toBeOnTheScreen();
  });

  it("a follow-up I may not act on (CanAct false) offers nothing, even on a lead I can edit", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(
      detail(lead(), { followups: [followUp({ CanAct: false }), followUp({ Id: 71, DueAt: "2099-01-03T15:00:00", CanAct: false })] }),
    );
    await mount();
    await loaded();
    expect(screen.getByTestId("next-followup").props.accessibilityRole).toBeUndefined();
    expect(screen.getByTestId("followup-71").props.accessibilityRole).toBeUndefined();
  });

  it("Send back is offered only when the server names who gave it", async () => {
    await mount();
    await loaded();
    expect(screen.queryByText(/Send back/)).toBeNull();
  });

  it("Send back posts remarks with SendBack and no reason, then leaves", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead({ SendBackToId: 14, SendBackToName: "Nitin Verma" })));
    const navigation = makeNavigation<"LeadDetail">();
    await mount(navigation);
    await loaded();
    // The ⋮ item, then the sheet title.
    expect(screen.getAllByText("Send back to Nitin Verma")).toHaveLength(2);
    await fireEvent.changeText(screen.getByTestId("compose-sendback"), "Wrong city");
    await fireEvent.press(screen.getByText("Send back to Nitin"));
    await waitFor(() =>
      expect(transferLead).toHaveBeenCalledWith(
        { LeadId: 11, ToUserId: 14, ToBranchId: null, Remarks: "Wrong city", SendBack: true },
        expect.anything(),
      ),
    );
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(await screen.findByText("Sent back to Nitin Verma")).toBeOnTheScreen();
  });

  it("a refused send back shows the server's sentence, refetches and drops the item (Review Focus 3)", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValueOnce(detail(lead({ SendBackToId: 14, SendBackToName: "Nitin Verma" })));
    jest.mocked(transferLead).mockRejectedValue(serverError(400, "Nitin Verma can no longer take this. Reassign it instead."));
    const navigation = makeNavigation<"LeadDetail">();
    await mount(navigation);
    await loaded();
    await fireEvent.changeText(screen.getByTestId("compose-sendback"), "Wrong city");
    await fireEvent.press(screen.getByText("Send back to Nitin"));
    expect(await screen.findByText("Nitin Verma can no longer take this. Reassign it instead.")).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText("Send back to Nitin Verma")).toBeNull());
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});

describe("a write on a lead that has gone", () => {
  it("a 404 on a status change leaves and toasts", async () => {
    jest.mocked(setLeadStatus).mockRejectedValue(serverError(404, "Not found"));
    const navigation = makeNavigation<"LeadDetail">();
    await mount(navigation);
    await loaded();
    await fireEvent.press(screen.getByRole("radio", { name: "New" }));
    await fireEvent.press(screen.getByText("Save · mark new"));
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(await screen.findByText(RECORD_GONE_MESSAGE)).toBeOnTheScreen();
  });
});

describe("details tab", () => {
  it("shows the facts the card does not carry, custom fields and Created", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(
      detail(lead({ AltMobile: "9876543210", Address: "12 MG Road", City: "Surat", Remarks: "Wants net metering" }), {
        fields: [{ FieldId: 1, Label: "Roof type", Type: "text", ValueText: "RCC flat", ValueNumber: null, ValueDate: null } as never],
      }),
    );
    await mount();
    await loaded();
    await fireEvent.press(screen.getByRole("tab", { name: "Details" }));
    for (const text of ["anil@sharma.in", "98765 43210", "Sharma Traders", "Head Office", "12 MG Road, Surat", "Wants net metering", "RCC flat", "Mon, 26 Oct"]) {
      expect(screen.getByText(text)).toBeOnTheScreen();
    }
  });

  it("a won lead shows the won banner; a lost lead its reason", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(
      detail(lead({ StatusCode: "converted", StatusName: "Won", WonValue: 150000, WonAt: null, CustomerName: "Sharma Traders" })),
    );
    await mount();
    await loaded();
    await fireEvent.press(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByText("Won for ₹1,50,000")).toBeOnTheScreen();
    expect(screen.getByText("customer: Sharma Traders")).toBeOnTheScreen();
  });

  it("a lost lead shows its reason in red", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead({ StatusCode: "lost", StatusName: "Lost", LostReason: "Price too high" })));
    await mount();
    await loaded();
    await fireEvent.press(screen.getByRole("tab", { name: "Details" }));
    const reasons = screen.getAllByText("Price too high").filter((n) => flat(n).color === colors.dangerText);
    expect(reasons).toHaveLength(1);
  });
});

it("Activity weaves activity, calls and transfers newest first, dropping the duplicate call row", async () => {
  jest.mocked(fetchLeadDetail).mockResolvedValue(
    detail(lead(), {
      activity: [
        { Id: 1, LeadId: 11, UserId: 42, UserName: "Test User", Type: "created", Summary: "Lead created", CreatedAt: "2026-11-01T10:00:00" },
        { Id: 2, LeadId: 11, UserId: 42, UserName: "Test User", Type: "call", Summary: "Outbound call logged", CreatedAt: "2026-11-01T11:00:00" },
        { Id: 3, LeadId: 11, UserId: null, UserName: null, Type: "something_new", Summary: null, CreatedAt: "2026-11-01T09:00:00" },
      ],
      assignments: [
        {
          Id: 1, FromUserId: 5, FromUserName: "Ravi Mehta", ToUserId: 9, ToUserName: "Priya Shah",
          FromBranchId: 1, FromBranchName: "Head Office", ToBranchId: 1, ToBranchName: "Head Office",
          ReasonId: 30, Reason: "On leave", Remarks: "covering", AssignedBy: 42,
          AssignedByName: "Test User", AssignedAt: "2026-11-01T13:00:00",
        },
      ],
    }),
  );
  jest.mocked(fetchCalls).mockResolvedValue([
    { Id: 5, CompId: 1, LeadId: 11, TicketId: null, UserId: 42, Direction: "out", OutcomeId: 40, Notes: "Spoke to owner", Duration: 3, CalledAt: "2026-11-01T11:00:00", CreatedBy: 42, CreatedAt: "2026-11-01T11:00:00" },
    { Id: 6, CompId: 1, LeadId: 11, TicketId: null, UserId: 77, Direction: "in", OutcomeId: null, Notes: null, Duration: null, CalledAt: "2026-11-01T12:00:00", CreatedBy: 77, CreatedAt: "2026-11-01T12:00:00" },
  ]);
  await mount();
  await loaded();
  await fireEvent.press(screen.getByRole("tab", { name: "Activity" }));
  expect(await screen.findByText("Lead created")).toBeOnTheScreen();
  expect(screen.queryByText("Outbound call logged")).toBeNull();
  expect(screen.getByText(/^Ayush Mishra · Reached · 3 min/)).toBeOnTheScreen();
  const titles = screen
    .getAllByText(/^(Ravi Mehta → Priya Shah — covering|Incoming call|Spoke to owner|Lead created|something_new)$/)
    .map((node) => node.props.children);
  expect(titles).toEqual(["Ravi Mehta → Priya Shah — covering", "Incoming call", "Spoke to owner", "Lead created", "something_new"]);
});

it("Activity with nothing on it says so", async () => {
  await mount();
  await loaded();
  await fireEvent.press(screen.getByRole("tab", { name: "Activity" }));
  expect(await screen.findByText("Nothing has happened yet.")).toBeOnTheScreen();
});

describe("a view-only role", () => {
  it("sees the facts, Call and Message, but no write actions, sheets or uploads", async () => {
    seedAuth({ UserId: 42, access: { modules: { leads: { ...FULL, add: false, edit: false, delete: false } } } });
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead(), { followups: [followUp(), followUp({ Id: 71 })] }));
    await mount();
    expect(await screen.findByRole("header", { name: "Anil Kumar" })).toBeOnTheScreen();
    await waitFor(() => expect(fetchAssignableUsers).toHaveBeenCalled());
    expect(bar()).toEqual(["Call", "Message"]);
    expect(screen.queryByLabelText("Lead actions")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit lead" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change status" })).toBeNull();
    for (const text of ["Change status", "Add follow-up", "Log a call", "Priya Shah", "Mark done", "Skip follow-up"]) {
      expect(screen.queryByText(text)).toBeNull();
    }
    // Rows do not open a menu.
    expect(screen.getByTestId("followup-71").props.accessibilityRole).toBeUndefined();
    await fireEvent.press(screen.getByRole("tab", { name: "Details" }));
    await waitFor(() => expect(fetchAttachments).toHaveBeenCalledWith({ Entity: "lead", EntityId: 11 }));
    expect(screen.queryByLabelText("Add a file")).toBeNull();
  });
});

describe("T3: at the rail", () => {
  beforeEach(() => setWindow(...TABLET));

  it("the actions sit in the band; the facts list fills the 300 column; the card has Mark done and Reschedule", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(
      detail(lead(), {
        followups: [followUp()],
        fields: [{ FieldId: 1, Label: "Roof type", Type: "text", ValueText: "RCC flat", ValueNumber: null, ValueDate: null } as never],
      }),
    );
    const { present } = spySheets();
    await mount();
    await loaded();
    expect(screen.getByText("Estimated value")).toBeOnTheScreen();
    // The band's Reassign comes before the reassign sheet's submit.
    expect(screen.getAllByRole("button", { name: "Reassign" })[0]).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Edit" })).toBeOnTheScreen();
    for (const label of ["Assigned to", "Source", "Product", "Roof type", "Created"]) expect(screen.getByText(label)).toBeOnTheScreen();
    expect(screen.getByText("RCC flat")).toBeOnTheScreen();

    present.mockClear();
    await fireEvent.press(screen.getByRole("button", { name: "Log follow-up" }));
    const card = within(screen.getByTestId("next-followup"));
    await fireEvent.press(card.getByRole("button", { name: "Mark done" }));
    await fireEvent.press(card.getByRole("button", { name: "Reschedule" }));
    await fireEvent.press(screen.getAllByRole("button", { name: "Reassign" })[0]!);
    expect(present).toHaveBeenCalledTimes(4);
  });
});
