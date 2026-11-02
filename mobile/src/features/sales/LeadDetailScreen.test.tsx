import { Linking, StyleSheet } from "react-native";
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import { fetchAttachments } from "../../api/attachmentQueries";
import { fetchCalls, logCall } from "../../api/callQueries";
import { fetchLookups, LOOKUP_KIND } from "../../api/configQueries";
import { completeFollowUp, scheduleFollowUp, skipFollowUp } from "../../api/followupQueries";
import { convertLead, fetchLeadDetail, setLeadStatus, transferLead } from "../../api/leadQueries";
import { fetchProducts } from "../../api/productQueries";
import { fetchAssignableUsers, fetchUserDirectory } from "../../api/userQueries";
import type { AssignableUser, FollowUp, Lead, LeadDetail, Lookup } from "../../types/api";
import { envelope, followUp as fixtureFollowUp, lead as fixtureLead, localDay, serverError } from "../../test/fixtures";
import { spySheets } from "../../test/sheets";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import LeadDetailScreen from "./LeadDetailScreen";

jest.mock("../../api/leadQueries");
jest.mock("../../api/followupQueries");
jest.mock("../../api/callQueries");
jest.mock("../../api/configQueries");
jest.mock("../../api/userQueries");
jest.mock("../../api/productQueries");
jest.mock("../../api/attachmentQueries");

const FULL = { view: true, add: true, edit: true, delete: true, reach: "Company" as const };

const lookup = (Id: number, Kind: string, Value: string, Code: string | null = null): Lookup => ({
  Id, CompId: 1, Kind, Value, Code, SortOrder: Id, IsActive: true,
});

const STATUSES = [
  lookup(1, LOOKUP_KIND.leadStatus, "Open", "open"),
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

// Thin wrappers over the shared fixtures with this file's defaults spelled out:
// Ravi (5) owns the lead, so the owner-exclusion and transfer tests mean what
// they say; the follow-up is due far ahead, so it is never overdue by accident.
const lead = (patch: Partial<Lead> = {}): Lead =>
  fixtureLead({
    Id: 11, BranchId: 1, BranchName: "Head Office", Name: "Anil Kumar", Company: "Sharma Traders",
    MobileNo: "9825012345", AltMobile: null, Email: "anil@sharma.in", SourceId: 1, SourceName: "Walk-in",
    PartnerName: null, ProductId: 1, ProductName: "Solar 5kW", StatusId: 1, StatusName: "Open",
    StatusCode: "open", OwnerId: 5, OwnerName: "Ravi Mehta", EstValue: 250000, Remarks: null,
    NextFollowupDate: null, IsOverdue: false, WonAt: null, WonValue: null, CreatedAt: "2026-11-01T10:00:00",
    ...patch,
  });

const followUp = (patch: Partial<FollowUp> = {}): FollowUp =>
  fixtureFollowUp({
    Id: 70, LeadId: 11, Type: "call", DueAt: "2099-01-01T10:00:00", Status: "open", AssignedTo: 5,
    AssignedToName: "Ravi Mehta", DoneAt: null, DoneByName: null, Outcome: null, Remarks: null, IsOverdue: false,
    ...patch,
  });

const detail = (row: Lead | null = lead(), extra: Partial<LeadDetail> = {}): LeadDetail => ({
  lead: row, fields: [], activity: [], followups: [], assignments: [], ...extra,
});

const mount = (navigation = makeNavigation<"LeadDetail">()) =>
  renderWithProviders(
    <LeadDetailScreen navigation={navigation} route={makeRoute("LeadDetail", { leadId: 11 })} />,
  );

/** The row, plus the lookups and users every sheet is built from. */
const loaded = async () => {
  expect(await screen.findByText("Anil Kumar")).toBeOnTheScreen();
  await screen.findByText("Qualified");
  await screen.findByText("Price too high");
  await screen.findAllByText("Reached");
  await screen.findByText("Priya Shah");
};


// Found on the emulator (Task 30): a right-aligned one-line value inside a
// column that shrink-wraps its children is laid out at full text width, and
// Android cuts the START off ("VIAESTRO Cust..."). The value has to fill the
// column so numberOfLines ellipsizes the end instead.
const fillsItsColumn = (text: string) => {
  const column = screen.getByText(text).parent;
  expect(StyleSheet.flatten(column?.props.style).alignItems).not.toBe("flex-end");
};

beforeEach(() => {
  seedAuth({ UserId: 42, access: { modules: { leads: FULL } } });
  jest.mocked(fetchAttachments).mockResolvedValue([]);
  jest.mocked(fetchLeadDetail).mockResolvedValue(detail());
  jest.mocked(fetchLookups).mockImplementation(async ({ Kind }) => LOOKUPS[Kind] ?? []);
  jest.mocked(fetchAssignableUsers).mockResolvedValue([ravi, priya]);
  jest.mocked(fetchProducts).mockResolvedValue([]);
  jest.mocked(fetchUserDirectory).mockResolvedValue([
    { Id: 42, FullName: "Test User", Username: null, Avatar: null, JobTitle: null },
  ]);
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
    expect(screen.queryByText(/Check your connection/)).toBeNull();
    await fireEvent.press(screen.getByLabelText("Go back"));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it("a resolved detail with no lead row is treated the same way", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(null));
    await mount();
    expect(await screen.findByText("Lead not available")).toBeOnTheScreen();
  });

  it("a server fault offers a retry", async () => {
    jest.mocked(fetchLeadDetail).mockRejectedValue(serverError(500, "Server error"));
    await mount();
    expect(
      await screen.findByText("The lead could not be loaded. Check your connection and try again."),
    ).toBeOnTheScreen();
  });
});

describe("details", () => {
  it("a long fact value fills its column, so it ellipsizes at the end", async () => {
    const company = "A company whose name is far too long to fit";
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead({ Company: company })));
    await mount();
    expect(await screen.findByText(company)).toBeOnTheScreen();
    fillsItsColumn(company);
  });

  it("shows the header, the facts and the custom fields off the row", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(
      detail(lead({ Address: "Ring Road", City: "Surat", Remarks: "Wants a site visit" }), {
        fields: [
          { FieldId: 1, FieldKey: "roof", Label: "Roof", Type: "text", ValueText: "RCC", ValueNumber: null, ValueDate: null },
          { FieldId: 2, FieldKey: "subsidy", Label: "Subsidy", Type: "checkbox", ValueText: null, ValueNumber: 0, ValueDate: null },
          { FieldId: 3, FieldKey: "kw", Label: "kW", Type: "number", ValueText: null, ValueNumber: 5, ValueDate: null },
          { FieldId: 4, FieldKey: "visit", Label: "Visit", Type: "date", ValueText: null, ValueNumber: null, ValueDate: "2026-12-01T00:00:00" },
        ],
      }),
    );
    await mount();
    await loaded();
    expect(screen.getByText("Sharma Traders · Open")).toBeOnTheScreen();
    expect(screen.getByText("9825012345")).toBeOnTheScreen();
    expect(screen.getByText("anil@sharma.in")).toBeOnTheScreen();
    expect(screen.getByText("Sharma Traders")).toBeOnTheScreen();
    expect(screen.getByText("Solar 5kW")).toBeOnTheScreen();
    expect(screen.getByText("₹2,50,000")).toBeOnTheScreen();
    expect(screen.getByText("Walk-in")).toBeOnTheScreen();
    expect(screen.getAllByText("Ravi Mehta").length).toBeGreaterThan(0);
    expect(screen.getByText("Head Office")).toBeOnTheScreen();
    expect(screen.getByText("Ring Road, Surat")).toBeOnTheScreen();
    expect(screen.getByText("Wants a site visit")).toBeOnTheScreen();
    expect(screen.getByText("RCC")).toBeOnTheScreen();
    expect(screen.getByText("No")).toBeOnTheScreen();
    expect(screen.getByText("5")).toBeOnTheScreen();
    expect(screen.getByText("2026-12-01")).toBeOnTheScreen();
    // Neither banner on an open lead.
    expect(screen.queryByText(/^Won for/)).toBeNull();
    expect(screen.queryByText("Lost reason")).toBeNull();
  });

  it("a won lead shows the won banner", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(
      detail(lead({ StatusId: 3, StatusName: "Won", StatusCode: "converted", WonValue: 50000, WonAt: "2026-11-01T10:00:00", CustomerName: "Sharma Traders" })),
    );
    await mount();
    expect(await screen.findByText("Won for ₹50,000")).toBeOnTheScreen();
    expect(screen.getByText(/customer: Sharma Traders/)).toBeOnTheScreen();
  });

  it("a lost lead shows its reason and no won banner", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(
      detail(lead({ StatusId: 4, StatusName: "Lost", StatusCode: "lost", Company: null, LostReason: "Price too high", WonValue: 1 })),
    );
    await mount();
    expect(await screen.findByText("Lost reason")).toBeOnTheScreen();
    // Header subtitle without a company is just the status.
    expect(screen.getAllByText("Lost").length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Won for/)).toBeNull();
  });

  it("a sparse won lead falls back to dashes, and shows the alternate mobile and partner when set", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(
      detail(
        lead({
          StatusId: 3, StatusName: null, StatusCode: "converted", WonValue: null, Company: null, Email: null,
          ProductName: null, EstValue: null, SourceName: null, OwnerName: null, BranchName: null,
          AltMobile: "9000000000", PartnerName: "Sun Partners",
        }),
        {
          fields: [
            { FieldId: 1, FieldKey: "ok", Label: "Ok", Type: "checkbox", ValueText: "true", ValueNumber: null, ValueDate: null },
            { FieldId: 2, FieldKey: "n", Label: "N", Type: "number", ValueText: null, ValueNumber: null, ValueDate: null },
            { FieldId: 3, FieldKey: "d", Label: "D", Type: "date", ValueText: null, ValueNumber: null, ValueDate: null },
            { FieldId: 4, FieldKey: "t", Label: "T", Type: "text", ValueText: "", ValueNumber: null, ValueDate: null },
          ],
        },
      ),
    );
    await mount();
    expect(await screen.findByText("Won for —")).toBeOnTheScreen();
    expect(screen.getByText("9000000000")).toBeOnTheScreen();
    expect(screen.getByText("Sun Partners")).toBeOnTheScreen();
    expect(screen.getByText("Yes")).toBeOnTheScreen();
    expect(screen.getAllByText("Unassigned").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(9);
  });

  it("the follow-ups tab labels overdue and skipped rows", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(
      detail(lead(), {
        followups: [
          followUp({ IsOverdue: true, DueAt: "2026-01-05T10:00:00", AssignedToName: null }),
          followUp({ Id: 72, Type: "meeting", Status: "skipped", DoneByName: null, DoneAt: null, Remarks: "rain" }),
        ],
      }),
    );
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Follow-ups"));
    expect(await screen.findByText("Overdue · 5 Jan")).toBeOnTheScreen();
    expect(screen.getByText("Assigned to —")).toBeOnTheScreen();
    expect(screen.getByText("Skipped")).toBeOnTheScreen();
    expect(screen.getByText("rain")).toBeOnTheScreen();
    expect(screen.getByText("— · ")).toBeOnTheScreen();
  });

  it("an overdue next follow-up is flagged on the summary", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(
      detail(lead({ NextFollowupDate: "2026-01-05T00:00:00", IsOverdue: true })),
    );
    await mount();
    expect(await screen.findByText(/^Overdue · /)).toBeOnTheScreen();
  });

  it("Call dials the lead's mobile", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await mount();
    await loaded();
    await fireEvent.press(screen.getByRole("button", { name: "Call" }));
    expect(openURL).toHaveBeenCalledWith("tel:9825012345");
    openURL.mockRestore();
  });

  it("a phone with no dialer says so instead of failing silently", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("no handler"));
    await mount();
    await loaded();
    await fireEvent.press(screen.getByRole("button", { name: "Call" }));
    expect(await screen.findByLabelText("Can't open the dialer on this device")).toBeOnTheScreen();
    openURL.mockRestore();
  });

  it("no mobile, no Call button", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead({ MobileNo: null })));
    await mount();
    await loaded();
    expect(screen.queryByRole("button", { name: "Call" })).toBeNull();
  });
});

describe("status", () => {
  it("a plain status posts setLeadStatus straight away", async () => {
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Qualified"));
    await waitFor(() =>
      expect(setLeadStatus).toHaveBeenCalledWith({ LeadId: 11, StatusId: 2 }, expect.anything()),
    );
  });

  it("a refused direct pick toasts the server's sentence", async () => {
    jest.mocked(setLeadStatus).mockRejectedValue(serverError(400, "Lead is locked"));
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Qualified"));
    expect(await screen.findByLabelText("Lead is locked")).toBeOnTheScreen();
  });

  it("Lost cannot submit until a reason is picked, then sends it", async () => {
    const { present } = spySheets();
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Lost"));
    expect(present).toHaveBeenCalled();
    expect(screen.getByText("Mark as Lost")).toBeOnTheScreen();
    expect(setLeadStatus).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText("Mark lost"));
    expect(setLeadStatus).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText("Price too high"));
    await fireEvent.press(screen.getByText("Mark lost"));
    await waitFor(() =>
      expect(setLeadStatus).toHaveBeenCalledWith(
        { LeadId: 11, StatusId: 4, LostReasonId: 10 },
        expect.anything(),
      ),
    );
  });

  it("a refused Lost shows the sentence in the sheet and keeps it open", async () => {
    jest.mocked(setLeadStatus).mockRejectedValue(serverError(400, "Lost reason is required"));
    const { dismiss } = spySheets();
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Lost"));
    await fireEvent.press(screen.getByText("Price too high"));
    dismiss.mockClear(); // picking "Lost" closed the status list
    await fireEvent.press(screen.getByText("Mark lost"));
    expect(await screen.findByText("Lost reason is required")).toBeOnTheScreen();
    // In the sheet, not a toast.
    expect(screen.queryByLabelText("Lost reason is required")).toBeNull();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("says nothing about lost reasons while they are still loading", async () => {
    jest.mocked(fetchLookups).mockImplementation(async ({ Kind }) =>
      Kind === LOOKUP_KIND.lostReason ? new Promise<Lookup[]>(() => {}) : (LOOKUPS[Kind] ?? []),
    );
    await mount();
    await screen.findByText("Qualified");
    await screen.findByText("On leave");
    expect(screen.queryByText("No lost reasons are set up. Add them on the web first.")).toBeNull();
  });

  it("with no lost reasons configured the sheet says so", async () => {
    jest.mocked(fetchLookups).mockImplementation(async ({ Kind }) =>
      Kind === LOOKUP_KIND.lostReason ? [] : (LOOKUPS[Kind] ?? []),
    );
    await mount();
    expect(
      await screen.findByText("No lost reasons are set up. Add them on the web first."),
    ).toBeOnTheScreen();
  });

  it("Won never calls setLeadStatus; the won sheet converts with the value", async () => {
    const { dismiss } = spySheets();
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Won"));
    expect(screen.getByText("Mark as Won")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByPlaceholderText("e.g. 50,000"), "50,000");
    dismiss.mockClear(); // picking "Won" closed the status list
    await fireEvent.press(screen.getByText("Mark won"));
    await waitFor(() =>
      expect(convertLead).toHaveBeenCalledWith(
        { LeadId: 11, WonValue: 50000, Remarks: null },
        expect.anything(),
      ),
    );
    expect(setLeadStatus).not.toHaveBeenCalled();
    await waitFor(() => expect(dismiss).toHaveBeenCalled());
  });

  it("a won value that is not a number is refused in the sheet", async () => {
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Won"));
    await fireEvent.changeText(screen.getByPlaceholderText("e.g. 50,000"), "lots");
    await fireEvent.press(screen.getByText("Mark won"));
    expect(await screen.findByText("Enter the value this lead was won for.")).toBeOnTheScreen();
    expect(convertLead).not.toHaveBeenCalled();
  });

  it("a refused win shows the server's sentence in the sheet", async () => {
    jest.mocked(convertLead).mockRejectedValue(serverError(400, "Lead is already won"));
    const { dismiss } = spySheets();
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Won"));
    await fireEvent.changeText(screen.getByPlaceholderText("e.g. 50,000"), "10");
    dismiss.mockClear();
    await fireEvent.press(screen.getByText("Mark won"));
    expect(await screen.findByText("Lead is already won")).toBeOnTheScreen();
    // In the sheet, not a toast.
    expect(screen.queryByLabelText("Lead is already won")).toBeNull();
    expect(screen.getByDisplayValue("10")).toBeOnTheScreen();
    expect(dismiss).not.toHaveBeenCalled();
  });
});

describe("follow-ups", () => {
  it("schedule needs a type and a day, then sends the local date", async () => {
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Add follow-up"));
    expect(scheduleFollowUp).not.toHaveBeenCalled();
    // The schedule sheet's chips come first.
    await fireEvent.press(screen.getAllByRole("radio", { name: "Call" })[0]!);
    await fireEvent.press(screen.getAllByRole("radio", { name: "Tomorrow" })[0]!);
    await fireEvent.press(screen.getByText("Add follow-up"));
    await waitFor(() =>
      expect(scheduleFollowUp).toHaveBeenCalledWith(
        { LeadId: 11, Type: "call", DueAt: localDay(1) },
        expect.anything(),
      ),
    );
  });

  it("a refused schedule shows the sentence in the sheet", async () => {
    jest.mocked(scheduleFollowUp).mockRejectedValue(serverError(400, "Due date is in the past"));
    await mount();
    await loaded();
    await fireEvent.press(screen.getAllByRole("radio", { name: "Visit" })[0]!);
    await fireEvent.press(screen.getAllByRole("radio", { name: "Today" })[0]!);
    await fireEvent.press(screen.getByText("Add follow-up"));
    expect(await screen.findByText("Due date is in the past")).toBeOnTheScreen();
    // In the sheet, not a toast.
    expect(screen.queryByLabelText("Due date is in the past")).toBeNull();
  });

  it("an open row offers Log and Skip; a done row does not", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(
      detail(lead(), {
        followups: [
          followUp(),
          followUp({ Id: 71, Type: "visit", Status: "done", DoneByName: "Ravi Mehta", DoneAt: "2026-11-01T10:00:00", Outcome: "Reached", Remarks: "met" }),
        ],
      }),
    );
    await mount();
    await loaded();
    // The tab counts open follow-ups only.
    expect(within(screen.getByRole("tab", { name: /Follow-ups/ })).getByText("1")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Follow-ups"));
    expect(await screen.findByText("Reached — met")).toBeOnTheScreen();
    expect(screen.getAllByRole("button", { name: "Log" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Skip" })).toHaveLength(1);
  });

  it("no follow-ups says so", async () => {
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Follow-ups"));
    expect(await screen.findByText(/^No follow-ups yet/)).toBeOnTheScreen();
  });

  it("a call follow-up's fractional minutes are rounded, not dropped by the server", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead(), { followups: [followUp()] }));
    await mount();
    await loaded();
    await fireEvent.press(screen.getByRole("button", { name: "Log follow-up" }));
    await fireEvent.changeText(screen.getByPlaceholderText("What was discussed — the next person reads this"), "ok");
    await fireEvent.changeText(screen.getByPlaceholderText("Call minutes"), "4.5");
    await fireEvent.press(screen.getByText("Mark done"));
    await waitFor(() =>
      expect(completeFollowUp).toHaveBeenCalledWith(expect.objectContaining({ Duration: 5 }), expect.anything()),
    );
  });

  it("logging a call needs remarks, defaults Direction to out and books the next one", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead(), { followups: [followUp()] }));
    const { dismiss } = spySheets();
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Follow-ups"));
    await fireEvent.press(await screen.findByRole("button", { name: "Log" }));
    expect(screen.getByText("Log the call")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Mark done"));
    expect(completeFollowUp).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByPlaceholderText("What was discussed — the next person reads this"), " will buy ");
    await fireEvent.changeText(screen.getByPlaceholderText("Call minutes"), "4");
    // The complete sheet's "Next follow-up" row comes after the schedule sheet's "When".
    await fireEvent.press(screen.getAllByRole("radio", { name: "In 3 days" })[1]!);
    await fireEvent.press(screen.getByText("Mark done"));
    await waitFor(() =>
      expect(completeFollowUp).toHaveBeenCalledWith(
        {
          Id: 70, Remarks: "will buy", OutcomeId: null, Direction: "out", Duration: 4,
          NextType: "call", NextDueAt: localDay(3),
        },
        expect.anything(),
      ),
    );
    await waitFor(() => expect(dismiss).toHaveBeenCalled());
  });

  it("logging a visit sends no direction, minutes or next", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead(), { followups: [followUp({ Type: "visit" })] }));
    await mount();
    await loaded();
    // The quick button logs the first open follow-up.
    await fireEvent.press(screen.getByRole("button", { name: "Log follow-up" }));
    expect(screen.getByText("Log the visit")).toBeOnTheScreen();
    expect(screen.queryByPlaceholderText("Call minutes")).toBeNull();
    await fireEvent.changeText(screen.getByPlaceholderText("What was discussed — the next person reads this"), "seen");
    await fireEvent.press(screen.getByText("Mark done"));
    await waitFor(() =>
      expect(completeFollowUp).toHaveBeenCalledWith(
        { Id: 70, Remarks: "seen", OutcomeId: null, Direction: null, Duration: null, NextType: null, NextDueAt: null },
        expect.anything(),
      ),
    );
  });

  it("a refused log keeps the sheet and what was typed", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead(), { followups: [followUp()] }));
    jest.mocked(completeFollowUp).mockRejectedValue(serverError(400, "Already done"));
    const { dismiss } = spySheets();
    await mount();
    await loaded();
    await fireEvent.press(screen.getByRole("button", { name: "Log follow-up" }));
    await fireEvent.changeText(screen.getByPlaceholderText("What was discussed — the next person reads this"), "typed");
    await fireEvent.press(screen.getByText("Mark done"));
    expect(await screen.findByText("Already done")).toBeOnTheScreen();
    // In the sheet, not a toast.
    expect(screen.queryByLabelText("Already done")).toBeNull();
    expect(screen.getByDisplayValue("typed")).toBeOnTheScreen();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("skip needs remarks, then sends them", async () => {
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead(), { followups: [followUp()] }));
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Follow-ups"));
    await fireEvent.press(await screen.findByRole("button", { name: "Skip" }));
    await fireEvent.press(screen.getByText("Skip follow-up"));
    expect(skipFollowUp).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByPlaceholderText("Why it is not happening"), "phone off");
    await fireEvent.press(screen.getByText("Skip follow-up"));
    await waitFor(() =>
      expect(skipFollowUp).toHaveBeenCalledWith({ Id: 70, Remarks: "phone off" }, expect.anything()),
    );
  });
});

describe("calls", () => {
  it("rounds fractional minutes to whole ones", async () => {
    await mount();
    await loaded();
    await fireEvent.press(screen.getAllByRole("radio", { name: "Outgoing" }).at(-1)!);
    await fireEvent.changeText(screen.getByPlaceholderText("0"), "2.6");
    await fireEvent.press(screen.getByText("Log call"));
    await waitFor(() =>
      expect(logCall).toHaveBeenCalledWith(expect.objectContaining({ Duration: 3 }), expect.anything()),
    );
  });

  it("logs a call with direction, outcome, notes and minutes", async () => {
    await mount();
    await loaded();
    // The call sheet's Direction row is the last one.
    await fireEvent.press(screen.getAllByRole("radio", { name: "Incoming" }).at(-1)!);
    await fireEvent.press(screen.getAllByRole("radio", { name: "Reached" }).at(-1)!);
    await fireEvent.changeText(screen.getByPlaceholderText("What was said"), "call back Monday");
    await fireEvent.changeText(screen.getByPlaceholderText("0"), "6");
    await fireEvent.press(screen.getByText("Log call"));
    await waitFor(() =>
      expect(logCall).toHaveBeenCalledWith(
        { LeadId: 11, Direction: "in", OutcomeId: 40, Notes: "call back Monday", Duration: 6 },
        expect.anything(),
      ),
    );
  });

  it("a refused call shows the sentence in the sheet", async () => {
    jest.mocked(logCall).mockRejectedValue(serverError(403, "You cannot edit this lead"));
    await mount();
    await loaded();
    await fireEvent.press(screen.getAllByRole("radio", { name: "Outgoing" }).at(-1)!);
    await fireEvent.press(screen.getByText("Log call"));
    expect(await screen.findByText("You cannot edit this lead")).toBeOnTheScreen();
    // In the sheet, not a toast.
    expect(screen.queryByLabelText("You cannot edit this lead")).toBeNull();
    expect(logCall).toHaveBeenCalledWith(
      { LeadId: 11, Direction: "out", OutcomeId: null, Notes: null, Duration: null },
      expect.anything(),
    );
  });
});

describe("transfer", () => {
  it("the pick list leaves out the current owner", async () => {
    await mount();
    await loaded();
    expect(screen.getByText("Sales · Head Office")).toBeOnTheScreen();
    expect(screen.queryByText("Manager · Head Office")).toBeNull();
  });

  it("with no transfer reasons configured the sheet says so, but not while loading", async () => {
    jest.mocked(fetchLookups).mockImplementation(async ({ Kind }) =>
      Kind === LOOKUP_KIND.transferReason ? [] : (LOOKUPS[Kind] ?? []),
    );
    await mount();
    expect(
      await screen.findByText("No transfer reasons are set up. Add them on the web first."),
    ).toBeOnTheScreen();
  });

  it("says nothing about transfer reasons while they are still loading", async () => {
    jest.mocked(fetchLookups).mockImplementation(async ({ Kind }) =>
      Kind === LOOKUP_KIND.transferReason ? new Promise<Lookup[]>(() => {}) : (LOOKUPS[Kind] ?? []),
    );
    await mount();
    await screen.findByText("Price too high");
    expect(screen.queryByText("No transfer reasons are set up. Add them on the web first.")).toBeNull();
  });

  it("needs a reason and remarks, and never sends an office", async () => {
    // Even when the new owner sits in another office: a non-wide caller gets
    // 403 for sending one, a wide caller would silently move the lead.
    jest.mocked(fetchAssignableUsers).mockResolvedValue([ravi, user(9, "Priya Shah", "Sales", 2)]);
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Priya Shah"));
    expect(screen.getByText("Transfer to Priya Shah")).toBeOnTheScreen();
    await fireEvent.press(screen.getAllByText("Transfer").at(-1)!);
    expect(transferLead).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText("On leave"));
    await fireEvent.changeText(screen.getByPlaceholderText("Anything the next person should know"), "covering");
    await fireEvent.press(screen.getAllByText("Transfer").at(-1)!);
    await waitFor(() =>
      expect(transferLead).toHaveBeenCalledWith(
        { LeadId: 11, ToUserId: 9, ToBranchId: null, ReasonId: 30, Remarks: "covering" },
        expect.anything(),
      ),
    );
  });

  it("a refused transfer shows the sentence in the sheet and keeps it open", async () => {
    jest.mocked(transferLead).mockRejectedValue(serverError(403, "Not in your team"));
    const { dismiss } = spySheets();
    await mount();
    await loaded();
    await fireEvent.press(screen.getByText("Priya Shah"));
    await fireEvent.press(screen.getByText("On leave"));
    await fireEvent.changeText(screen.getByPlaceholderText("Anything the next person should know"), "x");
    dismiss.mockClear(); // picking Priya closed the pick list
    await fireEvent.press(screen.getAllByText("Transfer").at(-1)!);
    expect(await screen.findByText("Not in your team")).toBeOnTheScreen();
    // In the sheet, not a toast.
    expect(screen.queryByLabelText("Not in your team")).toBeNull();
    expect(dismiss).not.toHaveBeenCalled();
  });
});

it("a successful write refreshes the lead, the list and the follow-up queue", async () => {
  const { queryClient } = await mount();
  await loaded();
  const spy = jest.spyOn(queryClient, "invalidateQueries");
  await fireEvent.press(screen.getByText("Qualified"));
  await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["lead", 11] }));
  expect(spy).toHaveBeenCalledWith({ queryKey: ["leads"] });
  expect(spy).toHaveBeenCalledWith({ queryKey: ["followups"] });
});

it("Edit lead opens the form for this lead", async () => {
  const navigation = makeNavigation<"LeadDetail">();
  await mount(navigation);
  await loaded();
  await fireEvent.press(screen.getByText("Edit lead"));
  expect(navigation.navigate).toHaveBeenCalledWith("LeadForm", { leadId: 11 });
});

it("History weaves activity, calls and transfers newest first, dropping the duplicate call row", async () => {
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
  await fireEvent.press(screen.getByText("History"));
  expect(await screen.findByText("Lead created")).toBeOnTheScreen();
  expect(screen.queryByText("Outbound call logged")).toBeNull();
  expect(screen.getByText(/^Test User · Reached · 3 min/)).toBeOnTheScreen();
  // Newest first: getAllByText returns nodes in tree order.
  const titles = screen
    .getAllByText(/^(Ravi Mehta → Priya Shah — covering|Incoming call|Spoke to owner|Lead created|something_new)$/)
    .map((node) => node.props.children);
  expect(titles).toEqual([
    "Ravi Mehta → Priya Shah — covering",
    "Incoming call",
    "Spoke to owner",
    "Lead created",
    "something_new",
  ]);
});

it("History with nothing on it says so", async () => {
  await mount();
  await loaded();
  await fireEvent.press(screen.getByText("History"));
  expect(await screen.findByText("Nothing has happened yet.")).toBeOnTheScreen();
});

describe("a view-only role", () => {
  it("sees the facts and Call, but no action menu, write sheets, follow-up buttons or upload", async () => {
    seedAuth({ UserId: 42, access: { modules: { leads: { ...FULL, add: false, edit: false, delete: false } } } });
    jest.mocked(fetchLeadDetail).mockResolvedValue(detail(lead(), { followups: [followUp()] }));
    await mount();
    expect(await screen.findByText("Anil Kumar")).toBeOnTheScreen();
    await waitFor(() => expect(fetchLookups).toHaveBeenCalledWith(expect.objectContaining({ Kind: LOOKUP_KIND.leadStatus })));
    await waitFor(() => expect(fetchAssignableUsers).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Call" })).toBeOnTheScreen();
    expect(screen.queryByLabelText("Lead actions")).toBeNull();
    for (const text of [
      "Change status", "Qualified", "Mark lost", "Mark won", "Schedule follow-up", "Add follow-up",
      "Log a call", "Log call", "Transfer", "Priya Shah", "Edit lead", "Mark done", "Skip follow-up",
    ]) {
      expect(screen.queryByText(text)).toBeNull();
    }
    expect(screen.queryByRole("button", { name: "Log follow-up" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Schedule" })).toBeNull();
    await fireEvent.press(screen.getByText("Follow-ups"));
    expect(await screen.findByText("Assigned to Ravi Mehta")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Log" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    await fireEvent.press(screen.getByText("Files"));
    await waitFor(() => expect(fetchAttachments).toHaveBeenCalledWith({ Entity: "lead", EntityId: 11 }));
    expect(screen.queryByLabelText("Add a file")).toBeNull();
  });

  it("with edit, the ⋮ menu and uploads are there", async () => {
    await mount();
    await loaded();
    expect(screen.getByLabelText("Lead actions")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Files"));
    expect(await screen.findByLabelText("Add a file")).toBeOnTheScreen();
  });
});
