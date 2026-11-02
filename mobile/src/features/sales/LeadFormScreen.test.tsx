import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchCustomFields, fetchLookups } from "../../api/configQueries";
import { createLead, fetchLeadDetail, updateLead } from "../../api/leadQueries";
import { fetchProducts } from "../../api/productQueries";
import { fetchAssignableUsers } from "../../api/userQueries";
import type { Access, AssignableUser, CustomFieldDef, LeadDetail, Lookup } from "../../types/api";
import { envelope, lead, localDay, serverError } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { PHONE, setWindow, TABLET } from "../../test/window";
import { colors } from "../../theme";
import { flat } from "../../test/style";
import LeadFormScreen from "./LeadFormScreen";

jest.mock("../../api/configQueries");
jest.mock("../../api/leadQueries");
jest.mock("../../api/productQueries");
jest.mock("../../api/userQueries");

const status = (Id: number, Value: string, Code: string): Lookup => ({
  Id, CompId: 1, Kind: "lead_status", Value, Code, SortOrder: Id, IsActive: true,
});

// Won listed first on purpose: it must neither be offered nor become the default.
const STATUSES = [status(3, "Won", "converted"), status(1, "New", "open"), status(2, "Hot", "qualified")];
const SOURCES: Lookup[] = [{ Id: 30, CompId: 1, Kind: "lead_source", Value: "Walk-in", Code: null, SortOrder: 1, IsActive: true }];

const person = (Id: number, FullName: string): AssignableUser => ({
  Id, FullName, Avatar: null, JobTitle: null, BranchId: 1, BranchName: null, ReportsTo: null,
});

const fieldDef = (patch: Partial<CustomFieldDef>): CustomFieldDef => ({
  Id: 70, CompId: 1, Entity: "lead", FieldKey: "roof", Label: "Roof type", Type: "dropdown", Options: '["Tin","RCC"]',
  IsRequired: true, SortOrder: 1, IsActive: true, CreatedBy: null, CreatedAt: null, ...patch,
});

const grant = (add: boolean, edit: boolean): Partial<Access> => ({
  modules: { leads: { view: true, add, edit, delete: false, reach: "Own" } },
});

const detail = (patch = {}): LeadDetail => ({
  lead: { ...lead({ Email: "ravi@patel.in", City: "Surat", State: "Gujarat", Pincode: "395001", Address: "Ring Road",
    AltMobile: "9000000001", SourceId: 30, EstValue: 250000, Remarks: "Wants 5 kW", PartnerId: 8, OwnerId: 42 }),
    ...patch },
  fields: [], activity: [], followups: [], assignments: [],
});

const mount = (leadId?: number, navigation = makeNavigation<"LeadForm">()) =>
  renderWithProviders(
    <LeadFormScreen navigation={navigation} route={makeRoute("LeadForm", leadId == null ? {} : { leadId })} />,
  );

const fillRequired = async () => {
  await fireEvent.changeText(screen.getByPlaceholderText("Who is it"), "Meera Joshi");
  await fireEvent.changeText(screen.getByPlaceholderText("10-digit mobile number"), "+91 98250 12345");
};

const saveButton = () => screen.getByRole("button", { name: "Save" });
const save = () => fireEvent.press(saveButton());

beforeEach(() => {
  setWindow(...PHONE);
  seedAuth({ UserId: 42, access: grant(true, true) });
  jest.mocked(fetchLookups).mockImplementation(async ({ Kind }) =>
    Kind === "lead_status" ? STATUSES : Kind === "lead_source" ? SOURCES : [],
  );
  jest.mocked(fetchAssignableUsers).mockResolvedValue([person(42, "Priya Shah"), person(9, "Asha Rao")]);
  jest.mocked(fetchProducts).mockResolvedValue([]);
  jest.mocked(fetchCustomFields).mockResolvedValue([]);
  jest.mocked(createLead).mockResolvedValue(envelope({ Id: 501 }));
  jest.mocked(updateLead).mockResolvedValue(envelope({ Id: 11 }));
  jest.mocked(fetchLeadDetail).mockResolvedValue(detail());
});

describe("create", () => {
  it("is not offered without the leads add right", async () => {
    seedAuth({ UserId: 42, access: grant(false, true) });
    await mount();
    expect(await screen.findByText("You can't add leads")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("needs a name, then a mobile number", async () => {
    await mount();
    await screen.findAllByText("Priya Shah (you)");
    await save();
    expect(screen.getByText("The lead needs a name.")).toBeOnTheScreen();
    // The name field turns to its error ring.
    expect(flat(screen.getByPlaceholderText("Who is it").parent).borderColor).toBe(colors.danger);
    await fireEvent.changeText(screen.getByPlaceholderText("Who is it"), "Meera Joshi");
    await save();
    expect(screen.getByText("A mobile number is required.")).toBeOnTheScreen();
    expect(createLead).not.toHaveBeenCalled();
  });

  it("starts in the first open status and never offers Won", async () => {
    await mount();
    // Trigger + its sheet row.
    expect(await screen.findAllByText("New")).toHaveLength(2);
    expect(screen.getByText("Hot")).toBeOnTheScreen();
    expect(screen.queryByText("Won")).toBeNull();
  });

  it("posts the full create: cleaned mobile, me as owner, first follow-up tomorrow, then opens the lead", async () => {
    const navigation = makeNavigation<"LeadForm">();
    const { queryClient } = await mount(undefined, navigation);
    const invalidate = jest.spyOn(queryClient, "invalidateQueries");
    await screen.findAllByText("Priya Shah (you)");
    await fillRequired();
    await fireEvent.press(screen.getByText("Walk-in"));
    await fireEvent.changeText(screen.getByPlaceholderText("Amount in rupees"), "1,20,000");
    await fireEvent.press(screen.getByText("Hot"));
    await save();

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("LeadDetail", { leadId: 501 }));
    expect(createLead).toHaveBeenCalledWith(
      {
        Name: "Meera Joshi", MobileNo: "9825012345", AltMobile: null, Email: null, Company: null,
        Address: null, City: null, State: null, Pincode: null, SourceId: 30, ProductId: null,
        EstValue: 120000, Remarks: null, StatusId: 2, OwnerId: 42, FirstFollowupAt: localDay(1), CustomJSON: null,
      },
    );
    for (const queryKey of [["leads"], ["lead", 501], ["followups"]]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
    }
  });

  it("with no open status the default is still never Won", async () => {
    jest.mocked(fetchLookups).mockImplementation(async ({ Kind }) =>
      Kind === "lead_status" ? [status(3, "Won", "converted"), status(2, "Hot", "qualified")] : [],
    );
    await mount();
    expect(await screen.findAllByText("Hot")).toHaveLength(2);
    await fillRequired();
    await save();
    await waitFor(() => expect(createLead).toHaveBeenCalledWith(expect.objectContaining({ StatusId: 2 })));
  });

  it("cannot be saved until the statuses and the team have loaded", async () => {
    let release!: (users: AssignableUser[]) => void;
    jest.mocked(fetchAssignableUsers).mockReturnValue(new Promise((resolve) => (release = resolve)));
    await mount();
    await screen.findAllByText("New");
    expect(saveButton()).toBeDisabled();
    release([person(42, "Priya Shah")]);
    await waitFor(() => expect(saveButton()).toBeEnabled());
  });

  it("a failed list says so, offers a retry, and keeps the save shut", async () => {
    jest.mocked(fetchAssignableUsers).mockRejectedValueOnce(serverError(500, "boom"));
    await mount();
    expect(await screen.findByText("Could not load the statuses or the team.")).toBeOnTheScreen();
    expect(saveButton()).toBeDisabled();
    await fireEvent.press(screen.getByText("Try again"));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(screen.queryByText("Could not load the statuses or the team.")).toBeNull();
  });

  it("a create reply without an Id goes back instead of opening a lead", async () => {
    jest.mocked(createLead).mockResolvedValue({ ...envelope({ Id: 0 }), data: null });
    const navigation = makeNavigation<"LeadForm">();
    await mount(undefined, navigation);
    await screen.findAllByText("Priya Shah (you)");
    await fillRequired();
    await save();
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("owner is nobody when I am not assignable; follow-up None sends null", async () => {
    jest.mocked(fetchAssignableUsers).mockResolvedValue([person(9, "Asha Rao")]);
    await mount();
    await screen.findByText("Asha Rao");
    expect(screen.getByText("Nobody yet")).toBeOnTheScreen();
    await fillRequired();
    await fireEvent.press(screen.getByText("None"));
    await save();
    await waitFor(() =>
      expect(createLead).toHaveBeenCalledWith(
        expect.objectContaining({ OwnerId: null, FirstFollowupAt: null }),
      ),
    );
  });

  it("a missing required custom field blocks the save; filled, it is serialised", async () => {
    jest.mocked(fetchCustomFields).mockResolvedValue([fieldDef({})]);
    await mount();
    expect(await screen.findByText("More details")).toBeOnTheScreen();
    expect(screen.getByText("Custom field")).toBeOnTheScreen();
    await fillRequired();
    await save();
    // At the field itself (it may be far below the band's Save), and in a toast that is always in view.
    expect(screen.getByText("Roof type is required.")).toBeOnTheScreen();
    expect(screen.getByText("Check the form — Roof type is required.")).toBeOnTheScreen();
    expect(createLead).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText("Tin"));
    await save();
    await waitFor(() => expect(createLead).toHaveBeenCalled());
    expect(JSON.parse(jest.mocked(createLead).mock.calls[0]![0].CustomJSON!)).toEqual([
      expect.objectContaining({ fieldId: 70, value: "Tin" }),
    ]);
  });

  it("a non-number estimated value is refused", async () => {
    await mount();
    await screen.findAllByText("Priya Shah (you)");
    await fillRequired();
    await fireEvent.changeText(screen.getByPlaceholderText("Amount in rupees"), "abc");
    await save();
    expect(screen.getByText("Estimated value must be a number.")).toBeOnTheScreen();
    expect(createLead).not.toHaveBeenCalled();
  });

  it("a 400 shows the server's message and keeps what was typed", async () => {
    jest.mocked(createLead).mockRejectedValue(serverError(400, "Mobile number must be 10 digits"));
    const navigation = makeNavigation<"LeadForm">();
    await mount(undefined, navigation);
    await screen.findAllByText("Priya Shah (you)");
    await fireEvent.changeText(screen.getByPlaceholderText("Who is it"), "Meera Joshi");
    await fireEvent.changeText(screen.getByPlaceholderText("10-digit mobile number"), "98250");
    await save();
    expect(await screen.findByText("Mobile number must be 10 digits")).toBeOnTheScreen();
    expect(screen.getByDisplayValue("Meera Joshi")).toBeOnTheScreen();
    expect(screen.getByDisplayValue("98250")).toBeOnTheScreen();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("success:false shows the server's message and stays", async () => {
    jest.mocked(createLead).mockResolvedValue(envelope({ Id: 0 }, { success: false, message: "Duplicate mobile" }));
    const navigation = makeNavigation<"LeadForm">();
    await mount(undefined, navigation);
    await screen.findAllByText("Priya Shah (you)");
    await fillRequired();
    await save();
    expect(await screen.findByText("Duplicate mobile")).toBeOnTheScreen();
    expect(screen.getByDisplayValue("Meera Joshi")).toBeOnTheScreen();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});

describe("E 16", () => {
  const LABELS = /^(Name|Mobile|Alternate mobile|Company|Source|Product|Estimated value|Status|Owner|First follow-up|Roof type|Email|City|State|Pincode|Address|Remarks)( \*)?$/;

  it("Save is in the band; the fields run in E's order, custom fields under More details", async () => {
    jest.mocked(fetchCustomFields).mockResolvedValue([fieldDef({})]);
    await mount();
    await screen.findByText("More details");
    expect(screen.getByText("New lead")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Close" })).toBeOnTheScreen();
    // Field labels only: a dropdown's sheet title repeats its label as a header.
    const labels = screen.getAllByText(LABELS).filter((n) => n.props.accessibilityRole !== "header");
    expect(labels.map((n) => String([n.props.children].flat()[0]))).toEqual([
      "Name", "Mobile", "Alternate mobile", "Company", "Source", "Product", "Estimated value", "Status", "Owner",
      "First follow-up", "Roof type", "Email", "City", "State", "Pincode", "Address", "Remarks",
    ]);
    // Me as owner reads "(you)".
    expect(screen.getAllByText("Priya Shah (you)").length).toBeGreaterThan(0);
  });

  it("first follow-up presets: Tomorrow by default with its help line; In 3 days; Pick date asks for a day", async () => {
    await mount();
    await screen.findAllByText("Priya Shah (you)");
    const day = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      return `Call on ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]}, ${d.getDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}`;
    };
    expect(screen.getAllByRole("tab").map((t) => t.props.accessibilityLabel)).toEqual(["Tomorrow", "In 3 days", "Pick date", "None"]);
    expect(screen.getByText(day(1))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("tab", { name: "In 3 days" }));
    expect(screen.getByText(day(3))).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("tab", { name: "Pick date" }));
    expect(screen.queryByText(/^Call on/)).toBeNull();
    await fillRequired();
    await save();
    expect(screen.getByText("Pick the day of the first follow-up.")).toBeOnTheScreen();
    expect(createLead).not.toHaveBeenCalled();
  });

  it("In 3 days books that local day", async () => {
    await mount();
    await screen.findAllByText("Priya Shah (you)");
    await fillRequired();
    await fireEvent.press(screen.getByRole("tab", { name: "In 3 days" }));
    await save();
    await waitFor(() => expect(createLead).toHaveBeenCalledWith(expect.objectContaining({ FirstFollowupAt: localDay(3) })));
  });

  it("T4: at the rail the form is one centred 640 card; the band holds Cancel and Save lead; Owner pairs with the first custom field", async () => {
    setWindow(...TABLET);
    jest.mocked(fetchCustomFields).mockResolvedValue([fieldDef({}), fieldDef({ Id: 71, Label: "Floors", Type: "text", IsRequired: false })]);
    const navigation = makeNavigation<"LeadForm">();
    await mount(undefined, navigation);
    await screen.findAllByText("Priya Shah (you)");
    expect(screen.getByRole("button", { name: "Save lead" })).toBeOnTheScreen();
    expect(screen.getByText(/· reminder in your Follow-ups queue$/)).toBeOnTheScreen();
    // The paired field is not repeated under More details.
    expect(screen.getAllByText(/^Roof type/).filter((n) => n.props.accessibilityRole !== "header")).toHaveLength(1);
    expect(screen.getByText("More details")).toBeOnTheScreen();
    // T4: the paired custom field's label carries the xs "Custom" chip.
    expect(screen.getByText("Custom").parent!.parent).toHaveTextContent(/^Roof type( \*)?\s*Custom$/);
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    expect(navigation.goBack).toHaveBeenCalled();
  });
});

describe("edit", () => {
  it("is not offered without the leads edit right", async () => {
    seedAuth({ UserId: 42, access: grant(true, false) });
    await mount(11);
    expect(await screen.findByText("You can't edit leads")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText("Edit lead")).toBeOnTheScreen();
  });

  it("a failed load offers a retry", async () => {
    jest.mocked(fetchLeadDetail).mockRejectedValue(serverError(404, "Lead not found"));
    await mount(11);
    await fireEvent.press(await screen.findByText("Try again"));
    await waitFor(() => expect(fetchLeadDetail).toHaveBeenCalledTimes(2));
  });

  it("seeds every field, hides the create-only ones, and saves the base record via updateLead", async () => {
    jest.mocked(fetchCustomFields).mockResolvedValue([fieldDef({})]);
    const navigation = makeNavigation<"LeadForm">();
    const { queryClient } = await mount(11, navigation);
    const invalidate = jest.spyOn(queryClient, "invalidateQueries");
    expect(await screen.findByDisplayValue("Ravi Patel")).toBeOnTheScreen();
    for (const v of ["Patel Solar", "9825012345", "9000000001", "ravi@patel.in", "Surat", "Gujarat", "395001",
      "Ring Road", "250000", "Wants 5 kW"]) {
      expect(screen.getByDisplayValue(v)).toBeOnTheScreen();
    }
    expect(screen.queryByText("Status")).toBeNull();
    expect(screen.queryByText("Owner")).toBeNull();
    expect(screen.queryByText("First follow-up")).toBeNull();
    expect(screen.queryByText("More details")).toBeNull();

    await fireEvent.changeText(screen.getByDisplayValue("Surat"), "Vadodara");
    await save();

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(createLead).not.toHaveBeenCalled();
    expect(updateLead).toHaveBeenCalledWith(
      {
        Id: 11, Name: "Ravi Patel", Company: "Patel Solar", MobileNo: "9825012345", AltMobile: "9000000001",
        Email: "ravi@patel.in", Address: "Ring Road", City: "Vadodara", State: "Gujarat", Pincode: "395001",
        SourceId: 30, ProductId: null, EstValue: 250000, Remarks: "Wants 5 kW",
      },
    );
    for (const queryKey of [["leads"], ["lead", 11], ["followups"]]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
    }
  });
});
