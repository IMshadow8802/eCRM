import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DoNotCall from "./DoNotCall";
import useAuthStore from "../../stores/useAuthStore";
import renderWithProviders from "../../test/renderWithProviders";
import { markRow, mockCallingEndpoints } from "../../test/callingMocks";

const ADMIN = { isAdmin: true, modules: {} };
const MANAGER = { isAdmin: false, modules: { calling: { view: true, edit: true } } };
const VIEWER = { isAdmin: false, modules: { calling: { view: true } } };
const as = (access) => useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, access });
const MARKS = [
  markRow({ LeadId: 44, CustomerId: 3, ContactId: 101, CallListId: 5 }),
  markRow({ Id: 32, Mobile: "9811456021", Mark: "caution", Note: "Speaks only Punjabi", Source: "admin", SetByName: "Ayush Mishra" }),
];

describe("Do not call page", () => {
  beforeEach(() => as(ADMIN));

  it("lists the marks with where each number appears", async () => {
    mockCallingEndpoints({ marks: MARKS });
    renderWithProviders(<DoNotCall />);
    const row = (await screen.findByText("9899011223")).closest("tr");
    for (const t of ["Do not call", "Asked never to be called again", "Priya Verma", "22-11-2026 17:22"]) expect(within(row).getByText(t)).toBeInTheDocument();
    expect(within(row).getByText("Lead")).toHaveAttribute("href", "/sales/leads/44");
    expect(within(row).getByText("Customer")).toHaveAttribute("href", "/support/customers?customerId=3");
    expect(within(row).getByText("Calling list")).toHaveAttribute("href", "/sales/calling-lists/5?tab=contacts");
    const other = screen.getByText("9811456021").closest("tr");
    expect(within(other).getByText("Call with caution")).toBeInTheDocument();
    expect(within(other).getByText("· admin")).toBeInTheDocument();
    expect(within(other).getByText("Not in the CRM yet")).toBeInTheDocument();
  });

  it("searches and switches to history", async () => {
    const cap = mockCallingEndpoints({ marks: [markRow({ ClearedAt: "2026-11-23T10:00:00", ClearedByName: "Ayush Mishra", ClearNote: "Wrong number" })] });
    renderWithProviders(<DoNotCall />);
    const user = userEvent.setup();
    await screen.findByText("9899011223");
    await user.click(screen.getByTestId("dnc-tabs-history"));
    await waitFor(() => expect(cap.markFetch.History).toBe(true));
    expect(await screen.findByText(/Ayush Mishra, 23-11-2026 10:00 — Wrong number/)).toBeInTheDocument();
    expect(screen.queryByTestId("clear-31")).toBeNull();
    await user.type(screen.getByRole("textbox", { name: /search/i }), "98990");
    await waitFor(() => expect(cap.markFetch.SearchTerm).toBe("98990"));
  });

  it("an admin adds a number and clears a mark with a note", async () => {
    const cap = mockCallingEndpoints({ marks: MARKS });
    renderWithProviders(<DoNotCall />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("add-number-btn"));
    expect(screen.getByTestId("mark-mobile")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByTestId("clear-31"));
    await user.click(screen.getByTestId("clear-confirm"));
    expect(await screen.findByText("Write why the mark is cleared")).toBeInTheDocument();
    await user.type(screen.getByTestId("clear-note"), "Customer asked again");
    await user.click(screen.getByTestId("clear-confirm"));
    await waitFor(() => expect(cap.markClear).toEqual({ Id: 31, ClearNote: "Customer asked again" }));
  });

  it("a refused clear stays in the dialog", async () => {
    mockCallingEndpoints({ marks: MARKS, fail: { markClear: "Mark not found" } });
    renderWithProviders(<DoNotCall />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("clear-31"));
    await user.type(screen.getByTestId("clear-note"), "x");
    await user.click(screen.getByTestId("clear-confirm"));
    expect(await screen.findByText("Mark not found")).toBeInTheDocument();
  });

  it("a list manager reads it without Add or Clear", async () => {
    as(MANAGER);
    mockCallingEndpoints({ marks: MARKS });
    renderWithProviders(<DoNotCall />);
    await screen.findByText("9899011223");
    expect(screen.queryByTestId("add-number-btn")).toBeNull();
    expect(screen.queryByTestId("clear-31")).toBeNull();
  });

  it("calling view without edit: managed by your manager, nothing asked", async () => {
    as(VIEWER);
    const cap = mockCallingEndpoints();
    renderWithProviders(<DoNotCall />);
    expect(screen.getByText("The do-not-call list is managed by your manager")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(cap.markFetch).toBeUndefined();
  });
});
