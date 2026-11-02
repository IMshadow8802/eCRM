import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchLookups } from "../../api/configQueries";
import { fetchTickets } from "../../api/ticketQueries";
import { fetchAssignableUsers } from "../../api/userQueries";
import type { Ticket } from "../../types/api";
import { envelope, pagination, ticket } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import ComplaintsScreen from "./ComplaintsScreen";

jest.mock("../../api/ticketQueries");
jest.mock("../../api/configQueries");
jest.mock("../../api/userQueries");

const row = ticket();

const ticketsReply = (tickets: Ticket[]) => envelope({ tickets, pagination: pagination(tickets.length) });

const mount = (navigation = makeNavigation<"Complaints">()) =>
  renderWithProviders(
    <ComplaintsScreen
      navigation={navigation}
      route={makeRoute("Complaints", undefined)}
    />,
  );

beforeEach(() => {
  jest.mocked(fetchTickets).mockResolvedValue(ticketsReply([row]));
  jest.mocked(fetchLookups).mockResolvedValue([]);
  jest.mocked(fetchAssignableUsers).mockResolvedValue([]);
  seedAuth({ UserId: 42 });
});

it("renders a ticket's subject", async () => {
  await mount();
  expect(await screen.findByText("Inverter keeps tripping")).toBeOnTheScreen();
  expect(fetchTickets).toHaveBeenCalledWith(expect.objectContaining({ AssignedTo: 42 }));
});

it("Team drops the AssignedTo filter", async () => {
  await mount();
  await screen.findByText("Inverter keeps tripping");
  await fireEvent.press(screen.getByText("Team"));
  await waitFor(() =>
    expect(fetchTickets).toHaveBeenLastCalledWith(expect.objectContaining({ AssignedTo: null })),
  );
});

it("Unassigned asks for the active complaints nobody has picked up", async () => {
  // CMP-04: the web's Unassigned preset.
  await mount();
  await screen.findByText("Inverter keeps tripping");
  // The segment comes before the card's own "Unassigned" line.
  await fireEvent.press(screen.getAllByText("Unassigned")[0]!);
  await waitFor(() =>
    expect(fetchTickets).toHaveBeenLastCalledWith(
      expect.objectContaining({ Unassigned: true, AssignedTo: null, StatusCode: "active" }),
    ),
  );
  expect(await screen.findByText("1 unassigned")).toBeOnTheScreen();
});

it("shows an error state when the fetch rejects", async () => {
  jest.mocked(fetchTickets).mockRejectedValue(new Error("boom"));
  await mount();
  expect(await screen.findByText("Couldn't load complaints")).toBeOnTheScreen();
});

it("the FAB opens a blank complaint form", async () => {
  const navigation = makeNavigation<"Complaints">();
  await mount(navigation);
  // Let the list settle first, or its late render lands outside act().
  await screen.findByText("Inverter keeps tripping");
  await fireEvent.press(screen.getByLabelText("Log a complaint"));
  expect(navigation.navigate).toHaveBeenCalledWith("ComplaintForm", {});
});
