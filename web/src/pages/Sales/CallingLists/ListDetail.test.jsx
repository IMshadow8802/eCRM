import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";

import ListDetail from "./ListDetail";
import useAuthStore from "../../../stores/useAuthStore";
import renderWithProviders from "../../../test/renderWithProviders";
import { callerRow, listRow, mockCallingEndpoints } from "../../../test/callingMocks";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));
vi.mock("./ListFormModal", () => ({ default: ({ list }) => <div data-testid="list-form-modal">{list?.Name}</div> }));

const ADMIN = { isAdmin: true, modules: {} };
const MANAGER = { isAdmin: false, modules: { calling: { view: true, add: false, edit: true, delete: false }, sales_reports: { view: true } } };
const VIEWER = { isAdmin: false, modules: { calling: { view: true } } };
const as = (access) => useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, access });
const LINE = { GroupKey: 5, GroupLabel: "MLSS", ListContacts: 4186, DialContacts: 744, DialReached: 402, New: 78, CohortWon: 6, CohortWonValue: 1140000, ListCost: 42000 };
const open = (path = "/sales/calling-lists/5") => renderWithProviders(
  <Routes><Route path="/sales/calling-lists/:listId" element={<ListDetail />} /></Routes>, { route: path },
);

describe("ListDetail", () => {
  beforeEach(() => { mockNavigate.mockReset(); as(ADMIN); });

  it("Overview: reads the list's report line any time and draws the funnel, today and the money", async () => {
    const cap = mockCallingEndpoints({ report: { rows: [LINE], totals: {} } });
    open();
    expect(await screen.findByText("MLSS Delhi — Lucky draw, Nov")).toBeInTheDocument();
    await screen.findByTestId("funnel-Won");
    expect(cap.report).toEqual({ GroupBy: "calllist", CallListId: 5 });
    expect(cap.fetchLists).toMatchObject({ Id: 5 });
    expect(within(screen.getByTestId("funnel-Called")).getByText("744")).toBeInTheDocument();
    expect(within(screen.getByTestId("funnel-Called")).getByText("17.8%")).toBeInTheDocument();
    expect(within(screen.getByTestId("funnel-Turned lead")).getByText("78")).toBeInTheDocument();
    expect(screen.getByText("Today · 81 calls")).toBeInTheDocument();
    const money = screen.getByTestId("money");
    for (const t of ["₹42,000", "₹538", "₹11,40,000", "₹27.1"]) expect(within(money).getByText(t)).toBeInTheDocument();
    expect(screen.getByTestId("every-call").getAttribute("href")).toBe("/reports/sales/calling/rows?line=calllist&metric=dial&shape=events&key=5&preset=any");
  });

  it("Overview: no money without a cost, and no figures without sales reports", async () => {
    as(MANAGER);
    mockCallingEndpoints({ report: { rows: [{ ...LINE, ListCost: null }] } });
    open();
    await screen.findByTestId("funnel-Won");
    expect(screen.queryByTestId("money")).toBeNull();
  });

  it("Overview: a viewer without sales reports gets no figures, and no Contacts or Settings tab", async () => {
    as(VIEWER);
    const cap = mockCallingEndpoints();
    open();
    expect(await screen.findByText("The figures need Sales reports access.")).toBeInTheDocument();
    expect(cap.report).toBeUndefined();
    // A viewer has no Contacts or Settings tab.
    expect(screen.queryByTestId("detail-tabs-contacts")).toBeNull();
  });

  it("a list the server does not find shows Calling list not found", async () => {
    mockCallingEndpoints({ lists: [] });
    open("/sales/calling-lists/77");
    expect(await screen.findByText("Calling list not found")).toBeInTheDocument();
  });

  it("header: pause sends the whole list, Add contacts opens the sheet modal, Give out gives a count", async () => {
    const cap = mockCallingEndpoints();
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("detail-pause"));
    await waitFor(() => expect(cap.saveList).toMatchObject({ Id: 5, Name: "MLSS Delhi — Lucky draw, Nov", HoldSize: 10, Status: "paused" }));
    await user.click(screen.getByTestId("add-contacts-btn"));
    expect(await screen.findByTestId("list-form-modal")).toHaveTextContent("MLSS Delhi");
  });

  it("Settings: validates tries and gap, saves through saveList with the same id", async () => {
    const cap = mockCallingEndpoints();
    open("/sales/calling-lists/5?tab=settings");
    const user = userEvent.setup();
    await user.clear(await screen.findByTestId("set-MaxAttempts"));
    await user.type(screen.getByTestId("set-MaxAttempts"), "11");
    await user.click(screen.getByTestId("set-save"));
    expect(await screen.findByTestId("settings-error")).toHaveTextContent("Tries per contact must be 1 to 10");
    await user.clear(screen.getByTestId("set-MaxAttempts"));
    await user.type(screen.getByTestId("set-MaxAttempts"), "5");
    await user.clear(screen.getByTestId("set-RetryGapHours"));
    await user.type(screen.getByTestId("set-RetryGapHours"), "200");
    await user.click(screen.getByTestId("set-save"));
    expect(await screen.findByText("Gap between tries must be 0 to 168 hours")).toBeInTheDocument();
    await user.clear(screen.getByTestId("set-RetryGapHours"));
    await user.type(screen.getByTestId("set-RetryGapHours"), "6");
    await user.clear(screen.getByTestId("set-Cost"));
    await user.type(screen.getByTestId("set-Cost"), "40000");
    await user.click(screen.getByTestId("set-save"));
    await waitFor(() => expect(cap.saveList).toMatchObject({ Id: 5, MaxAttempts: 5, RetryGapHours: 6, Cost: 40000, Status: "active", BranchId: 1 }));
  });

  it("Settings: archive asks first; delete surfaces the server's 409", async () => {
    const cap = mockCallingEndpoints({ fail: { deleteList: "This list has calls; archive it instead" } });
    open("/sales/calling-lists/5?tab=settings");
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("set-archive"));
    expect(await screen.findByText("Contacts with callers go back to the pool. The figures stay in reports.")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Archive" }).at(-1));
    await waitFor(() => expect(cap.saveList?.Status).toBe("archived"));
    await user.click(screen.getByTestId("set-delete"));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByTestId("settings-error")).toHaveTextContent("This list has calls; archive it instead");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("Settings: a manager without admin sees no cost and no delete", async () => {
    as(MANAGER);
    mockCallingEndpoints({ lists: [listRow({ Cost: null })] });
    open("/sales/calling-lists/5?tab=settings");
    await screen.findByTestId("set-MaxAttempts");
    expect(screen.queryByTestId("set-Cost")).toBeNull();
    expect(screen.queryByTestId("set-delete")).toBeNull();
  });

  it("Settings: a deleted list goes back to the lists", async () => {
    mockCallingEndpoints();
    open("/sales/calling-lists/5?tab=settings");
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("set-delete"));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/sales/calling-lists"));
  });

  it("Turned lead is one number: the funnel, the pool and the callers agree", async () => {
    mockCallingEndpoints({
      lists: [listRow({ Leads: 78 })],
      listCallers: [callerRow({ Leads: 50 }), callerRow({ UserId: 18, FullName: "Priya Verma", Leads: 28 })],
      report: { rows: [{ ...LINE, New: 90 }] }, // the report's reach-filtered count is not used here
    });
    open();
    const step = await screen.findByTestId("funnel-Turned lead");
    expect(within(step).getByText("78")).toBeInTheDocument();
    expect(screen.getByTestId("pool")).toHaveTextContent("78 turned lead");
    const today = screen.getByTestId("today");
    expect(within(today).getByText("Turned lead")).toBeInTheDocument();
    const perCaller = [...today.querySelectorAll("tbody tr")].map((r) => Number(r.children[2].textContent));
    expect(perCaller.reduce((a, b) => a + b, 0)).toBe(78);
    expect(within(screen.getByTestId("money")).getByText("₹538")).toBeInTheDocument();
  });

  it("Callers tab lists the callers from the list fetch", async () => {
    mockCallingEndpoints({ listCallers: [callerRow(), callerRow({ UserId: 18, FullName: "Priya Verma", IsPaused: true })] });
    open("/sales/calling-lists/5?tab=callers");
    expect(await screen.findByTestId("caller-row-18")).toHaveTextContent("Paused");
  });

  it("Overview: a failed report, a list with no leads and no callers", async () => {
    mockCallingEndpoints({ lists: [listRow({ Leads: 0 })], listCallers: [], report: { rows: [{ ...LINE, New: 0, ListCost: 0, CohortWonValue: null }] } });
    open();
    expect(await screen.findByText("No callers on this list yet.")).toBeInTheDocument();
    const money = await screen.findByTestId("money");
    expect(within(money).getAllByText("—")).toHaveLength(2);
    mockCallingEndpoints({ fail: { report: { message: "boom", status: 500 } } });
    open();
    expect(await screen.findByText("Couldn't load the figures.")).toBeInTheDocument();
  });

  it("a server failure that is not a 404 says it could not load", async () => {
    mockCallingEndpoints({ fail: { fetchLists: { message: "boom", status: 500 } } });
    open();
    expect(await screen.findByText("Couldn't load this list")).toBeInTheDocument();
  });

  it("a paused list resumes; an archived one offers no hand-out; Give out opens the count modal", async () => {
    const cap = mockCallingEndpoints({ lists: [listRow({ Status: "paused" }), listRow({ Id: 6, Name: "Old", Status: "archived" })] });
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByText("Resume"));
    await waitFor(() => expect(cap.saveList?.Status).toBe("active"));
    await user.click(screen.getByTestId("detail-give"));
    expect(await screen.findByTestId("give-count")).toBeInTheDocument();
  });

  it("an archived list has no pause, give or add buttons", async () => {
    mockCallingEndpoints({ lists: [listRow({ Status: "archived" })] });
    open();
    await screen.findByText("MLSS Delhi — Lucky draw, Nov");
    expect(screen.queryByTestId("detail-pause")).toBeNull();
    expect(screen.queryByTestId("add-contacts-btn")).toBeNull();
  });

  it("Settings: name, hold size and cost are checked, and a refusal is shown", async () => {
    mockCallingEndpoints({ fail: { saveList: "A list with this name already exists" } });
    open("/sales/calling-lists/5?tab=settings");
    const user = userEvent.setup();
    const err = () => screen.getByTestId("settings-error");
    await user.clear(await screen.findByTestId("set-Name"));
    await user.click(screen.getByTestId("set-save"));
    expect(err()).toHaveTextContent("Name is required");
    await user.type(screen.getByTestId("set-Name"), "Other");
    await user.clear(screen.getByTestId("set-HoldSize"));
    await user.type(screen.getByTestId("set-HoldSize"), "0");
    await user.click(screen.getByTestId("set-save"));
    expect(err()).toHaveTextContent("Each caller holds 1 to 200");
    await user.clear(screen.getByTestId("set-HoldSize"));
    await user.type(screen.getByTestId("set-HoldSize"), "12");
    await user.clear(screen.getByTestId("set-Cost"));
    await user.type(screen.getByTestId("set-Cost"), "-5");
    await user.click(screen.getByTestId("set-save"));
    expect(err()).toHaveTextContent("Cost must be 0 or more");
    await user.clear(screen.getByTestId("set-Cost"));
    fireEvent.click(screen.getByTestId("set-AutoTopUp"));
    await user.click(screen.getByTestId("set-save"));
    expect(await screen.findByText("A list with this name already exists")).toBeInTheDocument();
  });
});
