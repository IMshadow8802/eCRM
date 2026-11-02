import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

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

// FlatList schedules its batches on timers; real ones leak past the test.
jest.useFakeTimers();

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

describe("paging (CMP-05)", () => {
  const many = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => ticket({ Id: from + i, Subject: `Complaint ${from + i}` }));

  it("asks for 50 at a time and loads the next page at the end of the list", async () => {
    jest.mocked(fetchTickets)
      .mockResolvedValueOnce(envelope({ tickets: many(1, 50), pagination: pagination(120, { totalPages: 3 }) }))
      .mockResolvedValueOnce(envelope({ tickets: many(51, 50), pagination: pagination(120, { currentPage: 2, totalPages: 3 }) }));
    await mount();
    await screen.findByText("Complaint 1");
    // The header is the server's total, not the rows on screen.
    expect(screen.getByText("120 assigned to you")).toBeOnTheScreen();
    expect(fetchTickets).toHaveBeenLastCalledWith(expect.objectContaining({ PageNumber: 1, PageSize: 50 }));

    await fireEvent(screen.getByTestId("complaints-list"), "onEndReached");
    await waitFor(() =>
      expect(fetchTickets).toHaveBeenLastCalledWith(expect.objectContaining({ PageNumber: 2, PageSize: 50 })),
    );
  });

  it("does not ask past the last page", async () => {
    jest.mocked(fetchTickets).mockResolvedValue(envelope({ tickets: many(1, 3), pagination: pagination(3) }));
    await mount();
    await screen.findByText("Complaint 1");
    await fireEvent(screen.getByTestId("complaints-list"), "onEndReached");
    expect(fetchTickets).toHaveBeenCalledTimes(1);
  });
});

describe("search", () => {
  const box = () => screen.getByPlaceholderText("Ticket no., subject, customer or mobile");

  it("fast typing sends one request, for the final term", async () => {
    await mount();
    await screen.findByText("Inverter keeps tripping");
    jest.mocked(fetchTickets).mockClear();
    await fireEvent.changeText(box(), "s");
    await fireEvent.changeText(box(), "sh");
    await fireEvent.changeText(box(), "sha");
    await act(async () => { jest.advanceTimersByTime(299); });
    expect(fetchTickets).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(1); });
    await waitFor(() => expect(fetchTickets).toHaveBeenCalledTimes(1));
    expect(fetchTickets).toHaveBeenCalledWith(expect.objectContaining({ SearchTerm: "sha", PageNumber: 1 }));
  });

  it("keeps the previous rows on screen while the new search loads", async () => {
    await mount();
    await screen.findByText("Inverter keeps tripping");
    jest.mocked(fetchTickets).mockReturnValue(new Promise(() => {}));
    await fireEvent.changeText(box(), "sharma");
    await act(async () => { jest.advanceTimersByTime(300); });
    await waitFor(() => expect(fetchTickets).toHaveBeenLastCalledWith(expect.objectContaining({ SearchTerm: "sharma" })));
    expect(screen.getByText("Inverter keeps tripping")).toBeOnTheScreen();
    // A new search is not a pull-to-refresh: no spinner over the old rows.
    expect(screen.getByTestId("complaints-list").props.refreshControl.props.refreshing).toBe(false);
  });

  it("reaching the end of the old list during a new search asks for no next page", async () => {
    jest.mocked(fetchTickets).mockResolvedValue(
      envelope({ tickets: [row], pagination: pagination(120, { totalPages: 3 }) }),
    );
    await mount();
    await screen.findByText("Inverter keeps tripping");
    jest.mocked(fetchTickets).mockReturnValue(new Promise(() => {}));
    await fireEvent.changeText(box(), "sharma");
    await act(async () => { jest.advanceTimersByTime(300); });
    await waitFor(() => expect(fetchTickets).toHaveBeenLastCalledWith(expect.objectContaining({ SearchTerm: "sharma" })));
    const calls = jest.mocked(fetchTickets).mock.calls.length;
    await fireEvent(screen.getByTestId("complaints-list"), "onEndReached");
    await act(async () => { jest.advanceTimersByTime(50); });
    expect(fetchTickets).toHaveBeenCalledTimes(calls);
  });
});
