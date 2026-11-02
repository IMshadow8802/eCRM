import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchLookups } from "../../api/configQueries";
import { fetchLeads } from "../../api/leadQueries";
import { fetchProducts } from "../../api/productQueries";
import { fetchAssignableUsers } from "../../api/userQueries";
import useAuthStore from "../../stores/useAuthStore";
import type { Access, Lead, Lookup } from "../../types/api";
import { envelope, lead, pagination } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import LeadsScreen from "./LeadsScreen";

jest.mock("../../api/leadQueries");
jest.mock("../../api/configQueries");
jest.mock("../../api/productQueries");
jest.mock("../../api/userQueries");

// Lists arm VirtualizedList's batch timer on every data change; fake timers
// park it (RNTL's waitFor/findBy advance them).
jest.useFakeTimers();

const row = lead();

const leadsReply = (leads: Lead[], total = leads.length) =>
  envelope({ leads, pagination: pagination(total) });

const qualified: Lookup = {
  Id: 5,
  CompId: 1,
  Kind: "lead_status",
  Value: "Qualified",
  SortOrder: 2,
  IsActive: true,
  Code: "qualified",
};

const leadsGrant = (add: boolean): Partial<Access> => ({
  modules: { leads: { view: true, add, edit: true, delete: false, reach: "Own" } },
});

const mount = (navigation = makeNavigation<"Leads">()) =>
  renderWithProviders(<LeadsScreen navigation={navigation} route={makeRoute("Leads", undefined)} />);

beforeEach(() => {
  jest.mocked(fetchLeads).mockResolvedValue(leadsReply([row], 3));
  jest.mocked(fetchLookups).mockImplementation(({ Kind }) =>
    Promise.resolve(Kind === "lead_status" ? [qualified] : []),
  );
  jest.mocked(fetchProducts).mockResolvedValue([]);
  jest.mocked(fetchAssignableUsers).mockResolvedValue([]);
  seedAuth({ UserId: 42, access: leadsGrant(true) });
});

it("opens on Mine: the caller's own leads, counted in the header", async () => {
  await mount();
  expect(await screen.findByText("Ravi Patel")).toBeOnTheScreen();
  expect(screen.getByText("Leads")).toBeOnTheScreen();
  expect(screen.getByText("3 yours")).toBeOnTheScreen();
  expect(fetchLeads).toHaveBeenCalledWith(
    expect.objectContaining({
      OwnerId: 42,
      Overdue: false,
      StatusId: null,
      SearchTerm: null,
      PageNumber: 1,
      PageSize: 50,
    }),
  );
});

describe("paging", () => {
  const list = () => screen.getByTestId("leads-list");
  const pageCalls = (n: number) =>
    jest.mocked(fetchLeads).mock.calls.filter(([p]) => p?.PageNumber === n);

  it("reaching the end asks for the next page and shows it; the header keeps the server total", async () => {
    jest
      .mocked(fetchLeads)
      .mockResolvedValueOnce(leadsReply([row], 120))
      .mockResolvedValueOnce(leadsReply([lead({ Id: 12, Name: "Meera Joshi" })], 120));
    await mount();
    await screen.findByText("Ravi Patel");
    expect(screen.getByText("120 yours")).toBeOnTheScreen();

    await fireEvent(list(), "onEndReached");
    expect(await screen.findByText("Meera Joshi")).toBeOnTheScreen();
    expect(pageCalls(2)).toHaveLength(1);
    expect(pageCalls(2)[0]![0]).toEqual(expect.objectContaining({ OwnerId: 42, PageSize: 50 }));
    expect(screen.getByText("Ravi Patel")).toBeOnTheScreen();
    expect(screen.getByText("120 yours")).toBeOnTheScreen();
  });

  it("never asks past the last page", async () => {
    await mount(); // 3 rows = one page
    await screen.findByText("Ravi Patel");
    await fireEvent(list(), "onEndReached");
    await act(() => jest.advanceTimersByTime(1000));
    expect(pageCalls(2)).toHaveLength(0);
  });

  it("does not page while a new search is still loading over the old rows", async () => {
    jest.mocked(fetchLeads).mockResolvedValueOnce(leadsReply([row], 120)).mockReturnValue(new Promise(() => {}));
    await mount();
    await screen.findByText("Ravi Patel");
    await fireEvent.changeText(screen.getByPlaceholderText("Name, company or mobile"), "zz");
    await waitFor(() =>
      expect(fetchLeads).toHaveBeenLastCalledWith(expect.objectContaining({ SearchTerm: "zz" })),
    );
    const before = jest.mocked(fetchLeads).mock.calls.length;
    await fireEvent(list(), "onEndReached");
    await act(() => jest.advanceTimersByTime(1000));
    expect(fetchLeads).toHaveBeenCalledTimes(before);
  });
});

it("switching queue does not spin pull-to-refresh; a pull does", async () => {
  await mount();
  await screen.findByText("Ravi Patel");
  const spinning = () => screen.getByTestId("leads-list").props.refreshControl.props.refreshing;
  jest.mocked(fetchLeads).mockReturnValue(new Promise(() => {}));
  await fireEvent.press(screen.getByText("Overdue"));
  await waitFor(() =>
    expect(fetchLeads).toHaveBeenLastCalledWith(expect.objectContaining({ Overdue: true })),
  );
  expect(spinning()).toBe(false);

  // Back on Mine with a server that answers: let its background refetch land
  // so nothing is in flight and the rows are real, not a placeholder.
  jest.mocked(fetchLeads).mockResolvedValue(leadsReply([row], 3));
  const settled = jest.mocked(fetchLeads).mock.calls.length;
  await fireEvent.press(screen.getByText("Mine"));
  await screen.findByText("3 yours");
  await waitFor(() => expect(fetchLeads).toHaveBeenCalledTimes(settled + 1));
  await act(() => jest.advanceTimersByTime(100));
  expect(spinning()).toBe(false);

  // The pull, and only the pull, starts the spinner. It never settles, so
  // fire it without awaiting.
  jest.mocked(fetchLeads).mockReturnValue(new Promise(() => {}));
  await act(() => {
    void screen.getByTestId("leads-list").props.refreshControl.props.onRefresh();
  });
  await waitFor(() => expect(spinning()).toBe(true));
});

it("a row that shifts onto the next page while scrolling shows once", async () => {
  jest
    .mocked(fetchLeads)
    .mockResolvedValueOnce(leadsReply([row, lead({ Id: 12, Name: "Meera Joshi" })], 120))
    .mockResolvedValueOnce(
      leadsReply([lead({ Id: 12, Name: "Meera Joshi (moved)" }), lead({ Id: 13, Name: "Arjun Rao" })], 120),
    );
  await mount();
  await screen.findByText("Meera Joshi");
  await fireEvent(screen.getByTestId("leads-list"), "onEndReached");
  expect(await screen.findByText("Arjun Rao")).toBeOnTheScreen();
  // First occurrence wins: one Meera, the page-1 copy.
  expect(screen.getAllByText(/^Meera Joshi/)).toHaveLength(1);
  expect(screen.getByText("Meera Joshi")).toBeOnTheScreen();
});

it("does not fetch until the signed-in user is known", async () => {
  // A null OwnerId would turn Mine into the caller's whole reach.
  useAuthStore.setState({ UserId: null });
  await mount();
  await screen.findByText("Qualified");
  expect(fetchLeads).not.toHaveBeenCalled();
});

it("Overdue re-fetches with Overdue and no owner", async () => {
  await mount();
  await screen.findByText("Ravi Patel");
  await fireEvent.press(screen.getByText("Overdue"));
  await waitFor(() =>
    expect(fetchLeads).toHaveBeenLastCalledWith(expect.objectContaining({ Overdue: true, OwnerId: null })),
  );
});

it("a status chip narrows by StatusId", async () => {
  await mount();
  await screen.findByText("Ravi Patel");
  await fireEvent.press(await screen.findByText("Qualified"));
  await waitFor(() =>
    expect(fetchLeads).toHaveBeenLastCalledWith(expect.objectContaining({ StatusId: 5 })),
  );
});

it("typing a search term passes SearchTerm", async () => {
  await mount();
  await screen.findByText("Ravi Patel");
  await fireEvent.changeText(screen.getByPlaceholderText("Name, company or mobile"), "  patel ");
  await waitFor(() =>
    expect(fetchLeads).toHaveBeenLastCalledWith(expect.objectContaining({ SearchTerm: "patel" })),
  );
});

it("fast typing sends one request, for the final term", async () => {
  await mount();
  await screen.findByText("Ravi Patel");
  const input = screen.getByPlaceholderText("Name, company or mobile");
  await fireEvent.changeText(input, "p");
  await fireEvent.changeText(input, "pa");
  await fireEvent.changeText(input, "pat");
  await act(() => jest.advanceTimersByTime(299));
  expect(fetchLeads).toHaveBeenCalledTimes(1);
  await act(() => jest.advanceTimersByTime(1));
  await waitFor(() => expect(fetchLeads).toHaveBeenCalledTimes(2));
  expect(fetchLeads).toHaveBeenLastCalledWith(expect.objectContaining({ SearchTerm: "pat" }));
});

it("the previous rows stay up while a new search loads", async () => {
  await mount();
  await screen.findByText("Ravi Patel");
  jest.mocked(fetchLeads).mockReturnValue(new Promise(() => {}));
  await fireEvent.changeText(screen.getByPlaceholderText("Name, company or mobile"), "zz");
  await waitFor(() =>
    expect(fetchLeads).toHaveBeenLastCalledWith(expect.objectContaining({ SearchTerm: "zz" })),
  );
  expect(screen.getByText("Ravi Patel")).toBeOnTheScreen();
});

it("a rejected fetch shows the error state", async () => {
  jest.mocked(fetchLeads).mockRejectedValue(new Error("boom"));
  await mount();
  expect(await screen.findByText("Couldn't load leads")).toBeOnTheScreen();
});

it("an empty Mine says so; an empty search says nothing matches", async () => {
  jest.mocked(fetchLeads).mockResolvedValue(leadsReply([]));
  await mount();
  expect(await screen.findByText("No leads yet")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByPlaceholderText("Name, company or mobile"), "zz");
  expect(await screen.findByText("Nothing matches")).toBeOnTheScreen();
});

it("tapping a card opens the lead", async () => {
  const navigation = makeNavigation<"Leads">();
  await mount(navigation);
  await fireEvent.press(await screen.findByText("Ravi Patel"));
  expect(navigation.navigate).toHaveBeenCalledWith("LeadDetail", { leadId: 11 });
});

it("the FAB opens a blank lead form", async () => {
  const navigation = makeNavigation<"Leads">();
  await mount(navigation);
  await screen.findByText("Ravi Patel");
  await fireEvent.press(screen.getByLabelText("Add a lead"));
  expect(navigation.navigate).toHaveBeenCalledWith("LeadForm", {});
});

it("no add grant, no FAB — the server would refuse the create", async () => {
  seedAuth({ UserId: 42, access: leadsGrant(false) });
  await mount();
  await screen.findByText("Ravi Patel");
  expect(screen.queryByLabelText("Add a lead")).toBeNull();
});
