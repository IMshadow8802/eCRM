import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CallersTab from "./CallersTab";
import useAuthStore from "../../../stores/useAuthStore";
import renderWithProviders from "../../../test/renderWithProviders";
import { callerRow, listRow, mockCallingEndpoints } from "../../../test/callingMocks";

const CALLERS = [callerRow(), callerRow({ UserId: 18, FullName: "Priya Verma", HoldSize: 5, IsPaused: true, Holding: 7, Callbacks: 3 })];
const render = (canEdit = true, callers = CALLERS) => renderWithProviders(<CallersTab list={listRow()} callers={callers} canEdit={canEdit} />);

describe("CallersTab", () => {
  beforeEach(() => useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, access: { isAdmin: true, modules: {} } }));

  it("shows one row per caller with holding, callbacks, called today, leads and paused", () => {
    mockCallingEndpoints();
    render();
    const rohit = screen.getByTestId("caller-row-17");
    for (const t of ["Rohit Sharma", "10 / 10", "4", "34", "3"]) expect(within(rohit).getByText(t)).toBeInTheDocument();
    expect(within(screen.getByTestId("caller-row-18")).getByText("7 / 5")).toBeInTheDocument();
    expect(screen.getByTestId("pause-18")).toBeChecked();
    expect(screen.getByText("Turned lead")).toBeInTheDocument();
  });

  it("gives N to a caller", async () => {
    const cap = mockCallingEndpoints();
    render();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("give-caller-17"));
    await user.type(screen.getByTestId("give-count"), "15");
    await user.click(screen.getByTestId("give-submit"));
    await waitFor(() => expect(cap.assign).toEqual({ CallListId: 5, Assign: [{ UserId: 17, Count: 15 }] }));
  });

  it("pulls back all, with their callbacks when ticked", async () => {
    const cap = mockCallingEndpoints();
    render();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("recall-18"));
    fireEvent.click(screen.getByTestId("recall-callbacks"));
    await user.click(screen.getByTestId("action-confirm"));
    await waitFor(() => expect(cap.recall).toEqual({ CallListId: 5, FromUserId: 18, IncludeCallbacks: true }));
  });

  it("pauses and changes the hold size through saveCallers, and refuses a bad size", async () => {
    const cap = mockCallingEndpoints();
    render();
    const user = userEvent.setup();
    fireEvent.click(screen.getByTestId("pause-17"));
    await waitFor(() => expect(cap.saveCallers).toEqual({ CallListId: 5, Callers: [{ UserId: 17, HoldSize: null, IsPaused: true }] }));
    await user.clear(screen.getByTestId("hold-18"));
    await user.type(screen.getByTestId("hold-18"), "300");
    fireEvent.blur(screen.getByTestId("hold-18"));
    expect(await screen.findByTestId("callers-tab-error")).toHaveTextContent("Hold size must be 1 to 200");
    await user.clear(screen.getByTestId("hold-18"));
    await user.type(screen.getByTestId("hold-18"), "8");
    fireEvent.blur(screen.getByTestId("hold-18"));
    await waitFor(() => expect(cap.saveCallers).toEqual({ CallListId: 5, Callers: [{ UserId: 18, HoldSize: 8, IsPaused: true }] }));
  });

  it("removes a caller after a confirmation naming how many go back", async () => {
    const cap = mockCallingEndpoints({ fail: { saveCallers: (b) => (b.Callers[0].Remove ? null : "x") } });
    render();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("remove-18"));
    expect(screen.getByText("10 contacts they hold, callbacks included, go back to the pool.")).toBeInTheDocument();
    await user.click(screen.getByTestId("action-confirm"));
    await waitFor(() => expect(cap.saveCallers).toEqual({ CallListId: 5, Callers: [{ UserId: 18, Remove: true }] }));
  });

  it("adds a caller and shows a refusal", async () => {
    const cap = mockCallingEndpoints({ fail: { saveCallers: { message: "You cannot give contacts to that person", status: 403 } } });
    render();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("add-caller-btn"));
    await user.click(screen.getByTestId("give-to-input"));
    await user.click(await screen.findByRole("option", { name: /Arjun Mehta/ }));
    await user.click(screen.getByTestId("give-submit"));
    expect(await screen.findByTestId("give-error")).toHaveTextContent("You cannot give contacts to that person");
    expect(cap.saveCallers).toEqual({ CallListId: 5, Callers: [{ UserId: 20, IsPaused: false }] });
  });

  it("is read-only without edit, and says so when nobody works the list", () => {
    mockCallingEndpoints();
    render(false);
    expect(screen.queryByTestId("give-caller-17")).toBeNull();
    expect(screen.getByTestId("pause-17")).toBeDisabled();
    render(true, []);
    expect(screen.getByText(/Nobody works this list yet/)).toBeInTheDocument();
  });
});
