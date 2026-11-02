import { act, fireEvent, screen } from "@testing-library/react-native";

import { fetchLeads } from "../../api/leadQueries";
import { fetchTasks } from "../../api/taskQueries";
import { fetchTickets } from "../../api/ticketQueries";
import { envelope, lead, makeTask, pagination, ticket } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { PHONE, setWindow } from "../../test/window";
import type { ModuleKey } from "../../types/api";
import SearchScreen from "./SearchScreen";

jest.mock("../../api/ticketQueries", () => ({ ...jest.requireActual("../../api/ticketQueries"), fetchTickets: jest.fn() }));
jest.mock("../../api/leadQueries", () => ({ ...jest.requireActual("../../api/leadQueries"), fetchLeads: jest.fn() }));
jest.mock("../../api/taskQueries", () => ({ ...jest.requireActual("../../api/taskQueries"), fetchTasks: jest.fn() }));

const VIEW = { view: true, add: false, edit: false, delete: false, reach: "Own" as const };
const signInWith = (...modules: ModuleKey[]) =>
  seedAuth({ access: { modules: Object.fromEntries(modules.map((m) => [m, VIEW])) } });

beforeEach(() => {
  jest.useFakeTimers();
  setWindow(...PHONE);
  jest.mocked(fetchTickets).mockResolvedValue(envelope({
    tickets: [ticket({ Id: 5, TicketNo: "C-1042", Subject: "AC not cooling", CustomerName: "Rakesh", EscalatedTo: 3 })],
    pagination: pagination(12),
  }));
  jest.mocked(fetchLeads).mockResolvedValue(envelope({ leads: [lead({ Id: 8, Name: "Patel Solar", Company: "Patel" })], pagination: pagination(1) }));
  jest.mocked(fetchTasks).mockResolvedValue(envelope({ tasks: [makeTask({ Id: 3, Title: "AC quote", WorkspaceId: 10 })], pagination: pagination(1) }));
});
afterEach(() => jest.useRealTimers());

const mount = async () => {
  const navigation = makeNavigation<"Search">();
  await renderWithProviders(<SearchScreen navigation={navigation} route={makeRoute("Search", undefined)} />);
  return navigation;
};
const type = async (text: string) => {
  await fireEvent.changeText(screen.getByTestId("search-input"), text);
  await act(async () => { jest.advanceTimersByTime(300); });
};

it("asks for 2 letters before searching anything", async () => {
  signInWith("complaints", "leads", "tasks");
  await mount();
  expect(screen.getByText("Type at least 2 letters.")).toBeOnTheScreen();
  await type("a");
  expect(fetchTickets).not.toHaveBeenCalled();
  expect(screen.getByText("Type at least 2 letters.")).toBeOnTheScreen();
});

it("debounces, then asks each module once with the term, 5 rows", async () => {
  signInWith("complaints", "leads", "tasks");
  await mount();
  await fireEvent.changeText(screen.getByTestId("search-input"), "A");
  await fireEvent.changeText(screen.getByTestId("search-input"), "AC");
  expect(fetchTickets).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(300); });
  expect(await screen.findByText("Complaints · 12")).toBeOnTheScreen();
  expect(fetchTickets).toHaveBeenCalledTimes(1);
  expect(fetchTickets).toHaveBeenCalledWith({ SearchTerm: "AC", PageSize: 5 });
  expect(fetchLeads).toHaveBeenCalledWith({ SearchTerm: "AC", PageSize: 5 });
  expect(fetchTasks).toHaveBeenCalledWith({ SearchTerm: "AC", PageSize: 5 });
  expect(screen.getByText("Leads · 1")).toBeOnTheScreen();
  expect(screen.getByText("Tasks · 1")).toBeOnTheScreen();
  expect(screen.getByTestId("escalated-dot")).toBeOnTheScreen();
});

it("only modules the role can view are asked and shown", async () => {
  signInWith("leads");
  await mount();
  await type("Patel");
  expect(await screen.findByText("Leads · 1")).toBeOnTheScreen();
  expect(fetchTickets).not.toHaveBeenCalled();
  expect(fetchTasks).not.toHaveBeenCalled();
  expect(screen.queryByText(/^Complaints/)).toBeNull();
});

it("See all opens each list with the term; a row opens its record", async () => {
  signInWith("complaints", "leads", "tasks");
  const navigation = await mount();
  await type("AC");
  await screen.findByText("Complaints · 12");
  const [complaints, leads, tasks] = screen.getAllByRole("link", { name: "See all" });
  await fireEvent.press(complaints!);
  expect(navigation.navigate).toHaveBeenLastCalledWith("Tabs", { screen: "Complaints", params: { queue: "team", term: "AC" } });
  await fireEvent.press(leads!);
  expect(navigation.navigate).toHaveBeenLastCalledWith("Tabs", { screen: "Leads", params: { queue: "all", term: "AC" } });
  await fireEvent.press(tasks!);
  expect(navigation.navigate).toHaveBeenLastCalledWith("Tabs", { screen: "Tasks", params: { filter: "all", term: "AC" } });
  await fireEvent.press(screen.getByText("AC not cooling"));
  expect(navigation.navigate).toHaveBeenLastCalledWith("ComplaintDetail", { ticketId: 5 });
  await fireEvent.press(screen.getByText("Patel Solar"));
  expect(navigation.navigate).toHaveBeenLastCalledWith("LeadDetail", { leadId: 8 });
  await fireEvent.press(screen.getByText("AC quote"));
  expect(navigation.navigate).toHaveBeenLastCalledWith("TaskDetail", { taskId: 3, workspaceId: 10 });
});

it("nothing found says so; back goes back", async () => {
  jest.mocked(fetchLeads).mockResolvedValue(envelope({ leads: [], pagination: pagination(0) }));
  signInWith("leads");
  const navigation = await mount();
  await type("zz");
  expect(await screen.findByText("No matches")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Go back" }));
  expect(navigation.goBack).toHaveBeenCalled();
});

it("shows skeleton rows while the first answers are on their way", async () => {
  jest.mocked(fetchLeads).mockReturnValue(new Promise(() => {}));
  signInWith("leads");
  await mount();
  await type("Pat");
  expect(screen.getAllByTestId("skeleton-row").length).toBeGreaterThan(0);
});
