import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchCustomFields, fetchLookups, LOOKUP_KIND } from "../../api/configQueries";
import { fetchCustomers, saveCustomer } from "../../api/customerQueries";
import { fetchProducts } from "../../api/productQueries";
import { fetchTicketDetail, saveTicket } from "../../api/ticketQueries";
import { fetchAssignableUsers } from "../../api/userQueries";
import type { Customer, Lookup } from "../../types/api";
import { envelope, ticket } from "../../test/fixtures";
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

const sharma: Customer = {
  Id: 3, CompId: 1, BranchId: 1, BranchName: "Head Office", Name: "Sharma Traders",
  ContactPerson: "Mr Sharma", Mobile: "9825012345", AltMobile: null, Email: null,
  Address: null, City: "Surat", State: null, Pincode: null, Remarks: null, IsActive: true,
  OpenTickets: 1, TotalTickets: 3, LastTicketAt: null, CreatedAt: "2026-10-01T00:00:00",
} as Customer;

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
  // parity: CMP-06 — category, priority and description are demanded here; web needs only customer + subject.
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

it("shows each priority's TAT where it is chosen", async () => {
  await mount();
  expect(await screen.findByText("Due in 4h")).toBeOnTheScreen();
  expect(screen.getByText("Due in 3 days")).toBeOnTheScreen();
  expect(screen.getByText("No due time")).toBeOnTheScreen();
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

it("asks for each missing field in turn", async () => {
  await mount();
  await screen.findByText("Wiring");
  await fireEvent.changeText(screen.getByPlaceholderText("Search customer (mobile or name)"), "Sharma");
  await fireEvent.press(await screen.findByText("Sharma Traders"));
  await fireEvent.press(screen.getByText("Log complaint"));
  expect(await screen.findByText("What is the complaint about?")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByPlaceholderText("One line — what is wrong"), "Trips");
  await fireEvent.press(screen.getByText("Log complaint"));
  expect(await screen.findByText("Pick a category.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Wiring"));
  await fireEvent.press(screen.getByText("Log complaint"));
  expect(await screen.findByText("Pick a priority.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Urgent"));
  await fireEvent.press(screen.getByText("Log complaint"));
  expect(await screen.findByText("Describe the complaint.")).toBeOnTheScreen();
  expect(saveTicket).not.toHaveBeenCalled();
});

it("an unknown search offers to add the customer, carrying the typed number over", async () => {
  jest.mocked(fetchCustomers).mockResolvedValue([]);
  const navigation = makeNavigation<"ComplaintForm">();
  await mount(undefined, navigation);
  await screen.findByText("Wiring");
  await fireEvent.changeText(screen.getByPlaceholderText("Search customer (mobile or name)"), "98250 99999");
  expect(await screen.findByText("Nobody matches “98250 99999”. Add them as a new customer.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("New customer"));

  // parity: CUST-01 — the typed number arrives unnormalised; the Mobile input's slice/maxLength is a known bug, not pinned.
  expect(screen.getByPlaceholderText("10-digit number").props.value).toBe("98250 99999");
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
    { Name: "Patel Stores", ContactPerson: null, Mobile: "98250 99999", Email: null },
    expect.anything(),
  );
  expect(saveTicket).toHaveBeenCalledWith(
    expect.objectContaining({ Id: 0, CustomerId: 55, ContactPerson: "Patel Stores", Contact: "98250 99999" }),
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
  await fireEvent.changeText(screen.getByPlaceholderText("name@company.com"), "p@");
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

describe("editing", () => {
  it("opens on the complaint's own customer and saves its Id, with no assignee picker", async () => {
    jest.mocked(fetchTicketDetail).mockResolvedValue({
      ticket: ticket({
        CategoryId: 10,
        Priority: 20,
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
