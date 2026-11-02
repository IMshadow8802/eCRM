import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchCustomFields, fetchLookups, LOOKUP_KIND } from "../../api/configQueries";
import { fetchCustomers, saveCustomer } from "../../api/customerQueries";
import { fetchProducts } from "../../api/productQueries";
import { fetchTicketDetail, saveTicket } from "../../api/ticketQueries";
import { fetchAssignableUsers } from "../../api/userQueries";
import type { Lookup } from "../../types/api";
import { customer, envelope, serverError, ticket } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import ComplaintFormScreen from "./ComplaintFormScreen";

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
});

it("will not save without a customer", async () => {
  await mount();
  await screen.findByText("Wiring");
  await fireEvent.press(screen.getByText("Log complaint"));
  expect(await screen.findByText("Pick the customer, or add a new one.")).toBeOnTheScreen();
  expect(saveTicket).not.toHaveBeenCalled();
});

it("shows each priority's TAT in working hours where it is chosen", async () => {
  await mount();
  // CMP-07: TatHours are working hours on the assignee's shift since P4.
  expect(await screen.findByText("Due in 4 working hours")).toBeOnTheScreen();
  expect(screen.getByText("Due in 72 working hours")).toBeOnTheScreen();
  expect(screen.getByText("No due time")).toBeOnTheScreen();
  expect(screen.getByText("The priority sets the due date")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Urgent"));
  expect(screen.getByText("Due 4 working hours from when it is logged")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Someday"));
  expect(screen.getByText("This priority has no due date")).toBeOnTheScreen();
});

it("only the customer and the subject are required", async () => {
  // CMP-06: web and sp_SaveTicket need nothing more.
  const navigation = makeNavigation<"ComplaintForm">();
  await mount(undefined, navigation);
  await screen.findByText("Wiring");
  await fireEvent.changeText(screen.getByPlaceholderText("Search customer (mobile or name)"), "Sharma");
  await fireEvent.press(await screen.findByText("Sharma Traders"));
  await fireEvent.changeText(screen.getByPlaceholderText("One line — what is wrong"), "Trips at night");
  await fireEvent.press(screen.getByText("Log complaint"));
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
  await fireEvent.press(screen.getByText("Log complaint"));

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
  await fireEvent.press(screen.getByText("Log complaint"));
  expect(await screen.findByText("Customer is inactive")).toBeOnTheScreen();
  expect(navigation.goBack).not.toHaveBeenCalled();
});

it("a rejected save shows the server's message", async () => {
  jest.mocked(saveTicket).mockRejectedValue(new Error("Subject too long"));
  await mount();
  await screen.findByText("Wiring");
  await fillValidComplaint();
  await fireEvent.press(screen.getByText("Log complaint"));
  expect(await screen.findByText("Subject too long")).toBeOnTheScreen();
});

it("will not save without a subject", async () => {
  await mount();
  await screen.findByText("Wiring");
  await fireEvent.changeText(screen.getByPlaceholderText("Search customer (mobile or name)"), "Sharma");
  await fireEvent.press(await screen.findByText("Sharma Traders"));
  await fireEvent.press(screen.getByText("Log complaint"));
  expect(await screen.findByText("What is the complaint about?")).toBeOnTheScreen();
  expect(saveTicket).not.toHaveBeenCalled();
});

it("an unknown search offers to add the customer, carrying the typed number over", async () => {
  jest.mocked(fetchCustomers).mockResolvedValue([]);
  const navigation = makeNavigation<"ComplaintForm">();
  await mount(undefined, navigation);
  await screen.findByText("Wiring");
  await fireEvent.changeText(screen.getByPlaceholderText("Search customer (mobile or name)"), "9825099999");
  expect(await screen.findByText("Nobody matches “9825099999”. Add them as a new customer.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("New customer"));

  expect(screen.getByPlaceholderText("10-digit number").props.value).toBe("9825099999");
  await fireEvent.press(screen.getByText("Log complaint"));
  expect(await screen.findByText("The new customer needs a name.")).toBeOnTheScreen();

  await fireEvent.changeText(screen.getByPlaceholderText("Shop, company or person"), "Patel Stores");
  await fireEvent.changeText(screen.getByPlaceholderText("One line — what is wrong"), "No power");
  await fireEvent.press(screen.getByText("Wiring"));
  await fireEvent.press(screen.getByText("Urgent"));
  await fireEvent.changeText(screen.getByPlaceholderText("The complaint in the customer's words"), "Dead");
  await fireEvent.press(screen.getByText("Log complaint"));

  await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
  expect(saveCustomer).toHaveBeenCalledWith(
    { Name: "Patel Stores", ContactPerson: null, Mobile: "9825099999", Email: null, Address: null, City: null },
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
  await fireEvent.press(screen.getByText("New customer"));
  await fireEvent.changeText(screen.getByPlaceholderText("Shop, company or person"), "Patel Stores");
  await fireEvent.press(screen.getByText("Log complaint"));
  expect(await screen.findByText("A mobile number or an email is required for a new customer.")).toBeOnTheScreen();
});

it("a refused new customer stops before the complaint is sent", async () => {
  jest.mocked(saveCustomer).mockRejectedValue(new Error("Another customer already has this mobile number"));
  await mount();
  await screen.findByText("Wiring");
  await fireEvent.changeText(screen.getByPlaceholderText("Search customer (mobile or name)"), "Patel");
  await fireEvent.press(screen.getByText("New customer"));
  await fireEvent.changeText(screen.getByPlaceholderText("name@company.com"), "p@x.in");
  await fireEvent.changeText(screen.getByPlaceholderText("One line — what is wrong"), "No power");
  await fireEvent.press(screen.getByText("Wiring"));
  await fireEvent.press(screen.getByText("Urgent"));
  await fireEvent.changeText(screen.getByPlaceholderText("The complaint in the customer's words"), "Dead");
  await fireEvent.press(screen.getByText("Log complaint"));
  expect(await screen.findByText("Another customer already has this mobile number")).toBeOnTheScreen();
  expect(saveTicket).not.toHaveBeenCalled();
});

it("a new customer answered success:false says why", async () => {
  jest.mocked(saveCustomer).mockResolvedValue(envelope({ Id: 0 }, { success: false, message: "Bad email" }));
  await mount();
  await screen.findByText("Wiring");
  await fireEvent.press(screen.getByText("New customer"));
  await fireEvent.changeText(screen.getByPlaceholderText("Shop, company or person"), "Patel");
  await fireEvent.changeText(screen.getByPlaceholderText("name@company.com"), "p@x.in");
  await fireEvent.changeText(screen.getByPlaceholderText("One line — what is wrong"), "No power");
  await fireEvent.press(screen.getByText("Wiring"));
  await fireEvent.press(screen.getByText("Urgent"));
  await fireEvent.changeText(screen.getByPlaceholderText("The complaint in the customer's words"), "Dead");
  await fireEvent.press(screen.getByText("Log complaint"));
  expect(await screen.findByText("Bad email")).toBeOnTheScreen();
  expect(saveTicket).not.toHaveBeenCalled();
});

it("Search instead and Change go back to the search", async () => {
  await mount();
  await screen.findByText("Wiring");
  await fireEvent.press(screen.getByText("New customer"));
  await fireEvent.press(screen.getByText("Search instead"));
  await fireEvent.changeText(screen.getByPlaceholderText("Search customer (mobile or name)"), "Sharma");
  await fireEvent.press(await screen.findByText("Sharma Traders"));
  expect(screen.getByText("9825012345")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Change"));
  expect(screen.getByPlaceholderText("Search customer (mobile or name)")).toBeOnTheScreen();
});

it("a pasted +91 mobile is saved as its ten digits, not cut at the country code", async () => {
  // CUST-01: the old slice(0, 10) + maxLength turned this into 9198250999.
  const navigation = makeNavigation<"ComplaintForm">();
  await mount(undefined, navigation);
  await screen.findByText("Wiring");
  await fireEvent.press(screen.getByText("New customer"));
  await fireEvent.changeText(screen.getByPlaceholderText("Shop, company or person"), "Patel Stores");
  const mobile = screen.getByPlaceholderText("10-digit number");
  expect(mobile.props.maxLength).toBeUndefined();
  await fireEvent.changeText(mobile, "+91 98250 99999");
  await fireEvent.changeText(screen.getByPlaceholderText("Area, street"), " Ring Road ");
  await fireEvent.changeText(screen.getByPlaceholderText("Town or city"), "Surat");
  await fireEvent.changeText(screen.getByPlaceholderText("One line — what is wrong"), "No power");
  await fireEvent.press(screen.getByText("Log complaint"));
  await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
  expect(saveCustomer).toHaveBeenCalledWith(
    { Name: "Patel Stores", ContactPerson: null, Mobile: "9825099999", Email: null, Address: "Ring Road", City: "Surat" },
    expect.anything(),
  );
});

it("a searched +91 number carries over as ten digits", async () => {
  jest.mocked(fetchCustomers).mockResolvedValue([]);
  await mount();
  await screen.findByText("Wiring");
  await fireEvent.changeText(screen.getByPlaceholderText("Search customer (mobile or name)"), "+91 98250 99999");
  await fireEvent.press(screen.getByText("New customer"));
  expect(screen.getByPlaceholderText("10-digit number").props.value).toBe("9825099999");
});

it("a mobile the server refuses shows its message", async () => {
  jest.mocked(saveCustomer).mockRejectedValue(serverError(400, "Mobile must be 10 digits"));
  await mount();
  await screen.findByText("Wiring");
  await fireEvent.press(screen.getByText("New customer"));
  await fireEvent.changeText(screen.getByPlaceholderText("Shop, company or person"), "Patel");
  await fireEvent.changeText(screen.getByPlaceholderText("10-digit number"), "98250");
  await fireEvent.changeText(screen.getByPlaceholderText("One line — what is wrong"), "No power");
  await fireEvent.press(screen.getByText("Log complaint"));
  expect(await screen.findByText("Mobile must be 10 digits")).toBeOnTheScreen();
  expect(saveTicket).not.toHaveBeenCalled();
});

it("a malformed email is caught before anything is sent", async () => {
  // CUST-03: web checks the format; the phone used to post "p@" as-is.
  await mount();
  await screen.findByText("Wiring");
  await fireEvent.press(screen.getByText("New customer"));
  await fireEvent.changeText(screen.getByPlaceholderText("Shop, company or person"), "Patel");
  await fireEvent.changeText(screen.getByPlaceholderText("name@company.com"), "p@");
  await fireEvent.changeText(screen.getByPlaceholderText("One line — what is wrong"), "No power");
  await fireEvent.press(screen.getByText("Log complaint"));
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
    expect(screen.getByText("9825012345 · s@x.in")).toBeOnTheScreen();
    expect(screen.queryByText("Assign to")).toBeNull();
    // CMP-07: on edit the due date is the stored one, and a new priority
    // re-stamps it from when the complaint was raised — not from now.
    expect(screen.getByText("Due 03-11-2026 15:30")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Low"));
    expect(
      screen.getByText("Due date re-stamped to 72 working hours from when it was raised"),
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
    expect(await screen.findByText("Could not load this")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Try again"));
    await waitFor(() => expect(fetchTicketDetail).toHaveBeenCalledTimes(2));
    expect(fetchTicketDetail).toHaveBeenCalledWith({ TicketId: 7 });
  });
});
