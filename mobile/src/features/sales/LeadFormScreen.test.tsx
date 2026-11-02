import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchCustomFields, fetchLookups } from "../../api/configQueries";
import { createLead, fetchLeadDetail, updateLead } from "../../api/leadQueries";
import { fetchProducts } from "../../api/productQueries";
import { fetchAssignableUsers } from "../../api/userQueries";
import type { Access, AssignableUser, CustomFieldDef, LeadDetail, Lookup } from "../../types/api";
import { envelope, lead, localDay, serverError } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
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

const save = () => fireEvent.press(screen.getByText("Add lead"));

beforeEach(() => {
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
    expect(screen.queryByText("Add lead")).toBeNull();
  });

  it("needs a name, then a mobile number", async () => {
    await mount();
    await screen.findAllByText("Priya Shah");
    await save();
    expect(screen.getByText("The lead needs a name.")).toBeOnTheScreen();
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
    await screen.findAllByText("Priya Shah");
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
    expect(await screen.findByText("Extra details")).toBeOnTheScreen();
    await fillRequired();
    await save();
    expect(screen.getByText("Roof type is required.")).toBeOnTheScreen();
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
    await screen.findAllByText("Priya Shah");
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
    await screen.findAllByText("Priya Shah");
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
    await screen.findAllByText("Priya Shah");
    await fillRequired();
    await save();
    expect(await screen.findByText("Duplicate mobile")).toBeOnTheScreen();
    expect(screen.getByDisplayValue("Meera Joshi")).toBeOnTheScreen();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});

describe("edit", () => {
  it("is not offered without the leads edit right", async () => {
    seedAuth({ UserId: 42, access: grant(true, false) });
    await mount(11);
    expect(await screen.findByText("You can't edit leads")).toBeOnTheScreen();
    expect(screen.queryByText("Save changes")).toBeNull();
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
    expect(screen.queryByText("Extra details")).toBeNull();

    await fireEvent.changeText(screen.getByDisplayValue("Surat"), "Vadodara");
    await fireEvent.press(screen.getByText("Save changes"));

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
