import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as DocumentPicker from "expo-document-picker";

import { uploadAttachment } from "../../api/attachmentQueries";

import { fetchCustomFields, fetchLookups, LOOKUP_KIND } from "../../api/configQueries";
import { fetchCustomers, saveCustomer } from "../../api/customerQueries";
import { fetchProducts } from "../../api/productQueries";
import { fetchTicketDetail, saveTicket } from "../../api/ticketQueries";
import { fetchAssignableUsers, fetchBranches } from "../../api/userQueries";
import type { Lookup } from "../../types/api";
import { customer, envelope, serverError, ticket } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { PICKER_TYPES } from "../attachments/attachmentHelpers";
import ComplaintFormScreen from "./ComplaintFormScreen";

jest.mock("../../api/attachmentQueries");
jest.mock("../../api/configQueries");
jest.mock("../../api/customerQueries");
jest.mock("../../api/productQueries");
jest.mock("../../api/ticketQueries");
jest.mock("../../api/userQueries");

const lookup = (Id: number, Kind: string, Value: string, TatHours: number | null = null): Lookup => ({
  Id, CompId: 1, Kind, Value, Code: null, SortOrder: Id, IsActive: true, TatHours,
});

const LOOKUPS: Record<string, Lookup[]> = {
  [LOOKUP_KIND.ticketCategory]: [lookup(10, LOOKUP_KIND.ticketCategory, "Wiring")],
  [LOOKUP_KIND.priority]: [
    lookup(20, LOOKUP_KIND.priority, "Urgent", 4),
    lookup(21, LOOKUP_KIND.priority, "Low", 72),
    lookup(22, LOOKUP_KIND.priority, "Someday", null),
  ],
};

const sharma = customer();

const mount = (ticketId?: number, navigation = makeNavigation<"ComplaintForm">()) =>
  renderWithProviders(
    <ComplaintFormScreen
      navigation={navigation}
      route={makeRoute("ComplaintForm", ticketId == null ? {} : { ticketId })}
    />,
  );

/** Picks a customer from the search, then fills every field the form demands. */
const fillValidComplaint = async () => {
  await fireEvent.changeText(screen.getByPlaceholderText("Search customer (mobile or name)"), "Sharma");
  await fireEvent.press(await screen.findByText("Sharma Traders"));
  await fireEvent.changeText(screen.getByPlaceholderText("One line — what is wrong"), "Trips at night");
  await fireEvent.press(screen.getByText("Wiring"));
  await fireEvent.press(screen.getByText("Urgent"));
  await fireEvent.changeText(screen.getByPlaceholderText("The complaint in the customer's words"), "Every evening");
};

beforeEach(() => {
  seedAuth({ UserId: 42 });
  jest.mocked(fetchLookups).mockImplementation(async ({ Kind }) => LOOKUPS[Kind] ?? []);
  jest.mocked(fetchAssignableUsers).mockResolvedValue([
    { Id: 9, FullName: "Priya Shah", Avatar: null, JobTitle: "Technician", BranchId: 1, BranchName: null, ReportsTo: null },
  ]);
  jest.mocked(fetchCustomFields).mockResolvedValue([]);
  jest.mocked(fetchProducts).mockResolvedValue([]);
  jest.mocked(fetchCustomers).mockResolvedValue([sharma]);
  jest.mocked(saveTicket).mockResolvedValue(envelope({ Id: 101, TicketNo: "T-101" }));
  jest.mocked(saveCustomer).mockResolvedValue(envelope({ Id: 55 }));
  jest.mocked(fetchBranches).mockResolvedValue([
    { Id: 1, BranchName: "Head Office", IsActive: true },
    { Id: 2, BranchName: "Old Town", IsActive: true },
  ]);
  jest.mocked(uploadAttachment).mockResolvedValue(envelope({ attachmentId: 1 }));
});

it("E 12: once a term is typed, an X inside the search field clears it", async () => {
  await mount();
  const field = screen.getByPlaceholderText("Search customer (mobile or name)");
  expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  await fireEvent.changeText(field, "Sharma");
  const clear = screen.getByRole("button", { name: "Clear search" });
  // Inside the field box, after the text.
  expect(clear.parent).toBe(screen.getByPlaceholderText("Search customer (mobile or name)").parent);
  await fireEvent.press(clear);
  expect(screen.getByPlaceholderText("Search customer (mobile or name)").props.value).toBe("");
  expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
});

it("will not save without a customer", async () => {
  await mount();
  await screen.findByText("Wiring");
  await fireEvent.press(screen.getByText("Submit complaint"));
  expect(await screen.findByText("Pick the customer, or add a new one.")).toBeOnTheScreen();
  expect(saveTicket).not.toHaveBeenCalled();
});

it("shows each priority's TAT in working hours where it is chosen", async () => {
  await mount();
  // CMP-07: TatHours are working hours on the assignee's shift since P4.
  expect(await screen.findByText("Due in 4 working hours")).toBeOnTheScreen();
  expect(screen.getByText("Due in 72 working hours")).toBeOnTheScreen();
  expect(screen.getByText("No due time")).toBeOnTheScreen();
  expect(screen.getByText("The priority sets the due time.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Urgent"));
  expect(screen.getByText("Due 4 working hours from when it is logged.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Someday"));
  expect(screen.getByText("This priority has no due time.")).toBeOnTheScreen();
});

it("only the customer and the subject are required", async () => {
  // CMP-06: web and sp_SaveTicket need nothing more.
  const navigation = makeNavigation<"ComplaintForm">();
  await mount(undefined, navigation);
  await screen.findByText("Wiring");
  await fireEvent.changeText(screen.getByPlaceholderText("Search customer (mobile or name)"), "Sharma");
  await fireEvent.press(await screen.findByText("Sharma Traders"));
  await fireEvent.changeText(screen.getByPlaceholderText("One line — what is wrong"), "Trips at night");
  await fireEvent.press(screen.getByText("Submit complaint"));
  await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
  expect(saveTicket).toHaveBeenCalledWith(
    expect.objectContaining({ CategoryId: null, Priority: null, Description: null }),
    expect.anything(),
  );
});

it("a valid create posts Id 0 with the picked ids, prefills 'reported by', and goes back", async () => {
  const navigation = makeNavigation<"ComplaintForm">();
  await mount(undefined, navigation);
  await screen.findByText("Wiring");
  await fillValidComplaint();
  await fireEvent.press(screen.getByText("Priya Shah"));
  await fireEvent.press(screen.getByText("Submit complaint"));

  await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
  expect(fetchCustomers).toHaveBeenCalledWith({ SearchTerm: "Sharma", PageSize: 8 });
  expect(saveTicket).toHaveBeenCalledWith(
    {
      Id: 0,
      CustomerId: 3,
      Subject: "Trips at night",
      ContactPerson: "Mr Sharma",
      Contact: "9825012345",
      ChannelId: null,
      CategoryId: 10,
      Priority: 20,
      ProductId: null,
      AssignedTo: 9,
      Description: "Every evening",
      CustomJSON: null,
    },
    expect.anything(),
  );
});

it("success:false shows the server's message and stays on the form", async () => {
  jest.mocked(saveTicket).mockResolvedValue(
    envelope({ Id: 0 }, { success: false, message: "Customer is inactive" }),
  );
  const navigation = makeNavigation<"ComplaintForm">();
  await mount(undefined, navigation);
  await screen.findByText("Wiring");
  await fillValidComplaint();
  await fireEvent.press(screen.getByText("Submit complaint"));
  expect(await screen.findByText("Customer is inactive")).toBeOnTheScreen();
  expect(navigation.goBack).not.toHaveBeenCalled();
});

it("a rejected save shows the server's message", async () => {
  jest.mocked(saveTicket).mockRejectedValue(new Error("Subject too long"));
  await mount();
  await screen.findByText("Wiring");
  await fillValidComplaint();
  await fireEvent.press(screen.getByText("Submit complaint"));
  expect(await screen.findByText("Subject too long")).toBeOnTheScreen();
});

it("will not save without a subject", async () => {
  await mount();
  await screen.findByText("Wiring");
  await fireEvent.changeText(screen.getByPlaceholderText("Search customer (mobile or name)"), "Sharma");
  await fireEvent.press(await screen.findByText("Sharma Traders"));
  await fireEvent.press(screen.getByText("Submit complaint"));
  expect(await screen.findByText("What is the complaint about?")).toBeOnTheScreen();
  expect(saveTicket).not.toHaveBeenCalled();
});

it("an unknown search offers to add the customer, carrying the typed number over", async () => {
  jest.mocked(fetchCustomers).mockResolvedValue([]);
  const navigation = makeNavigation<"ComplaintForm">();
  await mount(undefined, navigation);
  await screen.findByText("Wiring");
  await fireEvent.changeText(screen.getByPlaceholderText("Search customer (mobile or name)"), "9825099999");
  expect(await screen.findByText("Nobody matches “9825099999”.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText(/^Add new customer/));

  expect(screen.getByPlaceholderText("10-digit number").props.value).toBe("9825099999");
  await fireEvent.press(screen.getByText("Submit complaint"));
  expect(await screen.findByText("The new customer needs a name.")).toBeOnTheScreen();

  await fireEvent.changeText(screen.getByPlaceholderText("Shop, company or person"), "Patel Stores");
  await fireEvent.changeText(screen.getByPlaceholderText("One line — what is wrong"), "No power");
  await fireEvent.press(screen.getByText("Wiring"));
  await fireEvent.press(screen.getByText("Urgent"));
  await fireEvent.changeText(screen.getByPlaceholderText("The complaint in the customer's words"), "Dead");
  await fireEvent.press(screen.getByText("Submit complaint"));

  await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
  expect(saveCustomer).toHaveBeenCalledWith(
    { Name: "Patel Stores", ContactPerson: null, Mobile: "9825099999", Email: null, Address: null, City: null, BranchId: null },
    expect.anything(),
  );
  expect(saveTicket).toHaveBeenCalledWith(
    expect.objectContaining({ Id: 0, CustomerId: 55, ContactPerson: "Patel Stores", Contact: "9825099999" }),
    expect.anything(),
  );
});

it("a new customer needs a mobile or an email", async () => {
  await mount();
  await screen.findByText("Wiring");
  await fireEvent.press(screen.getByText(/^Add new customer/));
  await fireEvent.changeText(screen.getByPlaceholderText("Shop, company or person"), "Patel Stores");
  await fireEvent.press(screen.getByText("Submit complaint"));
  expect(await screen.findByText("A mobile number or an email is required for a new customer.")).toBeOnTheScreen();
});

it("a refused new customer stops before the complaint is sent", async () => {
  jest.mocked(saveCustomer).mockRejectedValue(new Error("Another customer already has this mobile number"));
  await mount();
  await screen.findByText("Wiring");
  await fireEvent.changeText(screen.getByPlaceholderText("Search customer (mobile or name)"), "Patel");
  await fireEvent.press(screen.getByText(/^Add new customer/));
  await fireEvent.changeText(screen.getByPlaceholderText("name@company.com"), "p@x.in");
  await fireEvent.changeText(screen.getByPlaceholderText("One line — what is wrong"), "No power");
  await fireEvent.press(screen.getByText("Wiring"));
  await fireEvent.press(screen.getByText("Urgent"));
  await fireEvent.changeText(screen.getByPlaceholderText("The complaint in the customer's words"), "Dead");
  await fireEvent.press(screen.getByText("Submit complaint"));
  expect(await screen.findByText("Another customer already has this mobile number")).toBeOnTheScreen();
  expect(saveTicket).not.toHaveBeenCalled();
});

it("a new customer answered success:false says why", async () => {
  jest.mocked(saveCustomer).mockResolvedValue(envelope({ Id: 0 }, { success: false, message: "Bad email" }));
  await mount();
  await screen.findByText("Wiring");
  await fireEvent.press(screen.getByText(/^Add new customer/));
  await fireEvent.changeText(screen.getByPlaceholderText("Shop, company or person"), "Patel");
  await fireEvent.changeText(screen.getByPlaceholderText("name@company.com"), "p@x.in");
  await fireEvent.changeText(screen.getByPlaceholderText("One line — what is wrong"), "No power");
  await fireEvent.press(screen.getByText("Wiring"));
  await fireEvent.press(screen.getByText("Urgent"));
  await fireEvent.changeText(screen.getByPlaceholderText("The complaint in the customer's words"), "Dead");
  await fireEvent.press(screen.getByText("Submit complaint"));
  expect(await screen.findByText("Bad email")).toBeOnTheScreen();
  expect(saveTicket).not.toHaveBeenCalled();
});

it("Search instead and Change go back to the search", async () => {
  await mount();
  await screen.findByText("Wiring");
  await fireEvent.press(screen.getByText(/^Add new customer/));
  await fireEvent.press(screen.getByText("Search instead"));
  await fireEvent.changeText(screen.getByPlaceholderText("Search customer (mobile or name)"), "Sharma");
  await fireEvent.press(await screen.findByText("Sharma Traders"));
  expect(screen.getByText("Mr Sharma · 9825012345")).toBeOnTheScreen();
  await fireEvent.press(screen.getByLabelText("Change customer"));
  expect(screen.getByPlaceholderText("Search customer (mobile or name)")).toBeOnTheScreen();
});

it("a pasted +91 mobile is saved as its ten digits, not cut at the country code", async () => {
  // CUST-01: the old slice(0, 10) + maxLength turned this into 9198250999.
  const navigation = makeNavigation<"ComplaintForm">();
  await mount(undefined, navigation);
  await screen.findByText("Wiring");
  await fireEvent.press(screen.getByText(/^Add new customer/));
  await fireEvent.changeText(screen.getByPlaceholderText("Shop, company or person"), "Patel Stores");
  const mobile = screen.getByPlaceholderText("10-digit number");
  expect(mobile.props.maxLength).toBeUndefined();
  await fireEvent.changeText(mobile, "+91 98250 99999");
  await fireEvent.changeText(screen.getByPlaceholderText("Area, street"), " Ring Road ");
  await fireEvent.changeText(screen.getByPlaceholderText("Town or city"), "Surat");
  await fireEvent.changeText(screen.getByPlaceholderText("One line — what is wrong"), "No power");
  await fireEvent.press(screen.getByText("Submit complaint"));
  await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
  expect(saveCustomer).toHaveBeenCalledWith(
    { Name: "Patel Stores", ContactPerson: null, Mobile: "9825099999", Email: null, Address: "Ring Road", City: "Surat", BranchId: null },
    expect.anything(),
  );
});

it("a searched +91 number carries over as ten digits", async () => {
  jest.mocked(fetchCustomers).mockResolvedValue([]);
  await mount();
  await screen.findByText("Wiring");
  await fireEvent.changeText(screen.getByPlaceholderText("Search customer (mobile or name)"), "+91 98250 99999");
  await fireEvent.press(screen.getByText(/^Add new customer/));
  expect(screen.getByPlaceholderText("10-digit number").props.value).toBe("9825099999");
});

it("a mobile the server refuses shows its message", async () => {
  jest.mocked(saveCustomer).mockRejectedValue(serverError(400, "Mobile must be 10 digits"));
  await mount();
  await screen.findByText("Wiring");
  await fireEvent.press(screen.getByText(/^Add new customer/));
  await fireEvent.changeText(screen.getByPlaceholderText("Shop, company or person"), "Patel");
  await fireEvent.changeText(screen.getByPlaceholderText("10-digit number"), "98250");
  await fireEvent.changeText(screen.getByPlaceholderText("One line — what is wrong"), "No power");
  await fireEvent.press(screen.getByText("Submit complaint"));
  expect(await screen.findByText("Mobile must be 10 digits")).toBeOnTheScreen();
  expect(saveTicket).not.toHaveBeenCalled();
});

it("a malformed email is caught before anything is sent", async () => {
  // CUST-03: web checks the format; the phone used to post "p@" as-is.
  await mount();
  await screen.findByText("Wiring");
  await fireEvent.press(screen.getByText(/^Add new customer/));
  await fireEvent.changeText(screen.getByPlaceholderText("Shop, company or person"), "Patel");
  await fireEvent.changeText(screen.getByPlaceholderText("name@company.com"), "p@");
  await fireEvent.changeText(screen.getByPlaceholderText("One line — what is wrong"), "No power");
  await fireEvent.press(screen.getByText("Submit complaint"));
  expect(await screen.findByText("That email does not look right.")).toBeOnTheScreen();
  expect(saveCustomer).not.toHaveBeenCalled();
});

describe("editing", () => {
  it("opens on the complaint's own customer and saves its Id, with no assignee picker", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue({
      ticket: ticket({
        CategoryId: 10,
        Priority: 20,
        DueAt: "2026-11-03T15:30:00",
        Description: "Old text",
        ContactPerson: "Mr Sharma",
        Contact: "9825012345",
        CustomerContactPerson: "Mr Sharma",
        CustomerEmail: "s@x.in",
      }),
      fields: [],
      activity: [],
      assignments: [],
      linkedLead: null,
    });
    const navigation = makeNavigation<"ComplaintForm">();
    await mount(7, navigation);
    expect(await screen.findByText("T-7")).toBeOnTheScreen();
    expect(screen.getByText("Edit complaint")).toBeOnTheScreen();
    expect(screen.getByText("Mr Sharma · 9825012345")).toBeOnTheScreen();
    expect(screen.queryByText("Assign to")).toBeNull();
    // CMP-07: on edit the due date is the stored one, and a new priority
    // re-stamps it from when the complaint was raised — not from now.
    expect(screen.getByText(/^Due .*3:30 pm\.$/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Low"));
    expect(
      screen.getByText("Due time re-stamped to 72 working hours from when it was raised."),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByText("Save changes"));
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(saveTicket).toHaveBeenCalledWith(
      expect.objectContaining({ Id: 7, CustomerId: 3, Subject: "Inverter keeps tripping", AssignedTo: null }),
      expect.anything(),
    );
  });

  it("a complaint the caller cannot see says so", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue({
      ticket: null, fields: [], activity: [], assignments: [], linkedLead: null,
    });
    await mount(7);
    expect(await screen.findByText("Complaint not available")).toBeOnTheScreen();
  });

  it("a failed load offers a retry", async () => {
    jest.mocked(fetchTicketDetail).mockRejectedValue(new Error("boom"));
    await mount(7);
    expect(await screen.findByText("Could not load. Try again")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Try again"));
    await waitFor(() => expect(fetchTicketDetail).toHaveBeenCalledTimes(2));
    expect(fetchTicketDetail).toHaveBeenCalledWith({ TicketId: 7 });
  });
});

describe("customers belong to an office (CUST-02)", () => {
  const wide = { modules: { customers: { view: true, add: true, edit: true, delete: false, reach: "Company" as const } } };

  const newCustomer = async () => {
    await mount();
    await screen.findByText("Wiring");
    await fireEvent.press(screen.getByText(/^Add new customer/));
    await fireEvent.changeText(screen.getByPlaceholderText("Shop, company or person"), "Patel Stores");
    await fireEvent.changeText(screen.getByPlaceholderText("10-digit number"), "9825099999");
    await fireEvent.changeText(screen.getByPlaceholderText("One line — what is wrong"), "No power");
  };

  it("search results name the customer's office", async () => {
    await mount();
    await screen.findByText("Wiring");
    await fireEvent.changeText(screen.getByPlaceholderText("Search customer (mobile or name)"), "Sharma");
    expect(await screen.findByText("Mr Sharma · 9825012345 · Head Office · 1 open")).toBeOnTheScreen();
  });

  it("a wide customers reach picks the office, home office first, and the create sends it", async () => {
    seedAuth({ UserId: 42, BranchId: 1, access: wide });
    await newCustomer();
    expect(await screen.findByText("Office")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Old Town"));
    await fireEvent.press(screen.getByText("Submit complaint"));
    await waitFor(() =>
      expect(saveCustomer).toHaveBeenCalledWith(expect.objectContaining({ BranchId: 2 }), expect.anything()),
    );
  });

  it("left alone, the office is the caller's home office", async () => {
    seedAuth({ UserId: 42, BranchId: 1, access: wide });
    await newCustomer();
    await screen.findByText("Office");
    await fireEvent.press(screen.getByText("Submit complaint"));
    await waitFor(() =>
      expect(saveCustomer).toHaveBeenCalledWith(expect.objectContaining({ BranchId: 1 }), expect.anything()),
    );
  });

  it("a closed office is not offered", async () => {
    seedAuth({ UserId: 42, BranchId: 1, access: wide });
    jest.mocked(fetchBranches).mockResolvedValue([
      { Id: 1, BranchName: "Head Office", IsActive: true },
      { Id: 2, BranchName: "Old Town", IsActive: true },
      { Id: 3, BranchName: "Shut Depot", IsActive: false },
    ]);
    await newCustomer();
    await screen.findByText("Office");
    expect(screen.queryByText("Shut Depot")).toBeNull();
  });

  it("an own-office reach gets no office choice and never asks for the list", async () => {
    seedAuth({ UserId: 42, access: { modules: { customers: { ...wide.modules.customers, reach: "Own" } } } });
    await newCustomer();
    await fireEvent.press(screen.getByText("Submit complaint"));
    await waitFor(() =>
      expect(saveCustomer).toHaveBeenCalledWith(expect.objectContaining({ BranchId: null }), expect.anything()),
    );
    expect(screen.queryByText("Office")).toBeNull();
    expect(screen.queryByText("Office")).toBeNull();
  });

  it.each(["Office", "OfficeTree"] as const)(
    "a %s reach gets no office choice — the list is every office, the server would refuse most",
    async (reach) => {
      seedAuth({ UserId: 42, access: { modules: { customers: { ...wide.modules.customers, reach } } } });
      await newCustomer();
      await fireEvent.press(screen.getByText("Submit complaint"));
      await waitFor(() =>
        expect(saveCustomer).toHaveBeenCalledWith(expect.objectContaining({ BranchId: null }), expect.anything()),
      );
      expect(screen.queryByText("Office")).toBeNull();
      expect(screen.queryByText("Office")).toBeNull();
    },
  );

  it("a company with one office shows no choice", async () => {
    seedAuth({ UserId: 42, access: wide });
    jest.mocked(fetchBranches).mockResolvedValue([{ Id: 1, BranchName: "Head Office", IsActive: true }]);
    await newCustomer();
    await waitFor(() => expect(fetchBranches).toHaveBeenCalled());
    expect(screen.queryByText("Office")).toBeNull();
  });
});

describe("files picked on create (CMP-08)", () => {
  const doc = (name: string) => ({ uri: `file:///${name}`, name, mimeType: "image/jpeg", lastModified: 0, size: 10 });

  const pickFiles = async (...names: string[]) => {
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false, assets: names.map(doc) });
    await fireEvent.press(screen.getByLabelText("Attach files"));
    await screen.findByLabelText(`Remove ${names[0]!}`);
  };

  it("upload after the save, against the new complaint's Id", async () => {
    const navigation = makeNavigation<"ComplaintForm">();
    await mount(undefined, navigation);
    await screen.findByText("Wiring");
    await fillValidComplaint();
    await pickFiles("meter.jpg", "bill.jpg");
    expect(uploadAttachment).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText("Submit complaint"));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(uploadAttachment).toHaveBeenCalledTimes(2);
    expect(uploadAttachment).toHaveBeenCalledWith({
      Entity: "ticket",
      EntityId: 101,
      file: { uri: "file:///meter.jpg", name: "meter.jpg", type: "image/jpeg" },
    });
    expect(jest.mocked(saveTicket).mock.invocationCallOrder[0]!).toBeLessThan(
      jest.mocked(uploadAttachment).mock.invocationCallOrder[0]!,
    );
  });

  it("a removed file is not uploaded", async () => {
    const navigation = makeNavigation<"ComplaintForm">();
    await mount(undefined, navigation);
    await screen.findByText("Wiring");
    await fillValidComplaint();
    await pickFiles("meter.jpg", "bill.jpg");
    await fireEvent.press(screen.getByLabelText("Remove meter.jpg"));
    await fireEvent.press(screen.getByText("Submit complaint"));
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(uploadAttachment).toHaveBeenCalledTimes(1);
    expect(uploadAttachment).toHaveBeenCalledWith(expect.objectContaining({ file: expect.objectContaining({ name: "bill.jpg" }) }));
  });

  it("a failed upload keeps the complaint and says how many to add from the record", async () => {
    jest.mocked(uploadAttachment)
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(envelope({ attachmentId: 2 }));
    const navigation = makeNavigation<"ComplaintForm">();
    await mount(undefined, navigation);
    await screen.findByText("Wiring");
    await fillValidComplaint();
    await pickFiles("meter.jpg", "bill.jpg");
    await fireEvent.press(screen.getByText("Submit complaint"));
    expect(await screen.findByText("1 file(s) failed to upload — add them from the complaint")).toBeOnTheScreen();
    expect(navigation.goBack).toHaveBeenCalled();
    expect(saveTicket).toHaveBeenCalledTimes(1);
  });

  it("a save that answers no Id says the staged files did not go", async () => {
    jest.mocked(saveTicket).mockResolvedValue(envelope({ Id: 0 }));
    const navigation = makeNavigation<"ComplaintForm">();
    await mount(undefined, navigation);
    await screen.findByText("Wiring");
    await fillValidComplaint();
    await pickFiles("meter.jpg", "bill.jpg");
    await fireEvent.press(screen.getByText("Submit complaint"));
    expect(await screen.findByText("2 file(s) failed to upload — add them from the complaint")).toBeOnTheScreen();
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it("a file over the size limit is refused at the pick", async () => {
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({
      canceled: false, assets: [{ ...doc("huge.mov"), size: 300 * 1024 * 1024 }],
    });
    await mount();
    await screen.findByText("Wiring");
    await fireEvent.press(screen.getByLabelText("Attach files"));
    expect(await screen.findByText('"huge.mov" is larger than the 200 MB limit.')).toBeOnTheScreen();
  });

  // Same gate as the attachments list (ATT-01): only types upload.js takes, offered and checked.
  it("a type the server refuses is stopped at the pick; the picker offers only allowed types", async () => {
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [{ ...doc("notes.txt"), mimeType: "text/plain" }, { ...doc("spec.docx"), mimeType: undefined }],
    });
    await mount();
    await screen.findByText("Wiring");
    await fireEvent.press(screen.getByLabelText("Attach files"));
    expect(await screen.findByText('"notes.txt" — file type .txt is not allowed')).toBeOnTheScreen();
    expect(screen.getByText("spec.docx")).toBeOnTheScreen();
    expect(screen.queryByText("notes.txt")).toBeNull();
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({ copyToCacheDirectory: true, multiple: true, type: PICKER_TYPES });
  });

  it("editing a complaint offers no staging — files go on the record", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue({
      ticket: ticket(), fields: [], activity: [], assignments: [], linkedLead: null,
    });
    await mount(7);
    await screen.findByText("Edit complaint");
    expect(screen.queryByLabelText("Attach files")).toBeNull();
  });
});

describe("E 12", () => {
  it("fields in E's order, the office in the band, Submit at the foot", async () => {
    await mount();
    await screen.findByText("Wiring");
    const order = screen
      .getAllByText(/^(Customer|Subject|Description|Category|Priority|Attachments · 0)( \*)?$/)
      .map((t) => String([t.props.children].flat()[0]));
    expect(order).toEqual(["Customer", "Subject", "Description", "Category", "Priority", "Attachments · 0"]);
    expect(await screen.findByText("Head Office")).toBeOnTheScreen();
    expect(screen.getByText("New complaint")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Submit complaint" })).toBeOnTheScreen();
    expect(screen.getByText("More details")).toBeOnTheScreen();
  });

  it("the dropdown ends with Add new customer \"{term}\"", async () => {
    await mount();
    await screen.findByText("Wiring");
    expect(screen.getByText("Add new customer")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByPlaceholderText("Search customer (mobile or name)"), "Sharma");
    expect(await screen.findByText('Add new customer "Sharma"')).toBeOnTheScreen();
  });

  it("a picked document is a card with its kind and size; a picked priority shows as its chip", async () => {
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///invoice.pdf", name: "invoice.pdf", mimeType: "application/pdf", lastModified: 0, size: 284 * 1024 }],
    });
    await mount();
    await screen.findByText("Wiring");
    await fireEvent.press(screen.getByLabelText("Attach files"));
    expect(await screen.findByText("PDF · 284 KB")).toBeOnTheScreen();
    expect(screen.getByText("Attachments · 1")).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText("Remove invoice.pdf"));
    expect(screen.getByText("Attachments · 0")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("radio", { name: "Urgent" }));
    expect(screen.getByRole("button", { name: "Priority: Urgent" })).toBeOnTheScreen();
  });
});
