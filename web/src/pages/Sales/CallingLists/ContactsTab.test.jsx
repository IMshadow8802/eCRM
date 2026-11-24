import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ContactsTab from "./ContactsTab";
import useAuthStore from "../../../stores/useAuthStore";
import renderWithProviders from "../../../test/renderWithProviders";
import { callerRow, contactRow, listRow, mockCallingEndpoints } from "../../../test/callingMocks";

const ROWS = [
  contactRow(),
  contactRow({ Id: 102, Name: "Mr. RAJINDER SINGH BEDI", Mobile: "9811456021", Status: "callback", CallbackAt: "2026-11-24T16:00:00", Attempts: 2, LastResult: "callback", LastCalledAt: "2026-11-24T11:05:00", PhoneMark: "caution" }),
  contactRow({ Id: 103, Name: "Mrs. SUNITA BAKSHI", Status: "closed", CloseReason: "not_interested", HeldBy: null, HeldByName: null, LastResult: "not_interested" }),
];
const render = (route = "/") => renderWithProviders(<ContactsTab list={listRow()} callers={[callerRow()]} canAdd />, { route });
const tick = (id) => fireEvent.click(within(screen.getByText(id).closest("tr")).getByRole("checkbox"));

describe("ContactsTab", () => {
  beforeEach(() => useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, access: { isAdmin: true, modules: {} } }));

  it("shows the pool columns and filters by status, caller, last result and the two quick filters", async () => {
    const cap = mockCallingEndpoints({ contacts: ROWS });
    render();
    const row = (await screen.findByText("Mr. RAJINDER SINGH BEDI")).closest("tr");
    for (const t of ["9811456021", "Callback", "Rohit Sharma", "2", "Call back", "24-11-2026 11:05", "24-11-2026 16:00", "Caution"]) expect(within(row).getByText(t)).toBeInTheDocument();
    expect(within(screen.getByText("Mrs. SUNITA BAKSHI").closest("tr")).getByText("Closed")).toBeInTheDocument();
    expect(cap.fetchContacts).toMatchObject({ CallListId: 5, Status: null, Stale: false, Missed: false });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("contacts-status-input"));
    await user.click(await screen.findByRole("option", { name: "Callback" }));
    await waitFor(() => expect(cap.fetchContacts.Status).toBe("callback"));
    await user.click(screen.getByTestId("contacts-caller-input"));
    await user.click(await screen.findByRole("option", { name: "Rohit Sharma" }));
    await waitFor(() => expect(cap.fetchContacts.HeldBy).toBe(17));
    await user.click(screen.getByTestId("contacts-result-input"));
    await user.click(await screen.findByRole("option", { name: "No answer" }));
    await waitFor(() => expect(cap.fetchContacts.LastResult).toBe("no_answer"));
    await user.click(screen.getByTestId("quick-stale"));
    await waitFor(() => expect(cap.fetchContacts.Stale).toBe(true));
    await user.click(screen.getByTestId("quick-missed"));
    await waitFor(() => expect(cap.fetchContacts.Missed).toBe(true));
  });

  it("?missed=1 preselects missed callbacks", async () => {
    const cap = mockCallingEndpoints({ contacts: ROWS });
    render("/sales/calling-lists/5?tab=contacts&missed=1");
    await screen.findByText("Mrs. HARJEET KAUR");
    expect(cap.fetchContacts.Missed).toBe(true);
    expect(screen.getByTestId("quick-missed")).toHaveAttribute("aria-pressed", "true");
  });

  it("gives ticked contacts to a person, and moves them when every ticked one is a callback", async () => {
    const cap = mockCallingEndpoints({ contacts: ROWS });
    render();
    const user = userEvent.setup();
    await screen.findByText("Mrs. HARJEET KAUR");
    tick("Mrs. HARJEET KAUR");
    expect(screen.getByTestId("bulk-bar")).toHaveTextContent("1 selected");
    await user.click(screen.getByTestId("bulk-give"));
    await user.click(screen.getByTestId("give-to-input"));
    await user.click(await screen.findByRole("option", { name: /Priya Verma/ }));
    await user.click(screen.getByTestId("give-submit"));
    expect(await screen.findByTestId("give-result")).toHaveTextContent("18 given");
    expect(cap.assign).toEqual({ CallListId: 5, ContactIds: [101], ToUserId: 18 });
    await user.click(screen.getByTestId("give-done"));
    tick("Mr. RAJINDER SINGH BEDI");
    await user.click(screen.getByTestId("bulk-give"));
    expect(screen.getByText(/These are booked callbacks/)).toBeInTheDocument();
    await user.click(screen.getByTestId("give-to-input"));
    await user.click(await screen.findByRole("option", { name: /Priya Verma/ }));
    await user.click(screen.getByTestId("give-submit"));
    await waitFor(() => expect(cap.setState).toEqual({ CallListId: 5, ContactIds: [102], Action: "move", ToUserId: 18 }));
  });

  it("pulls back, removes and recycles after a confirmation, keeping a refusal in the dialog", async () => {
    const cap = mockCallingEndpoints({ contacts: ROWS, fail: { setState: (b) => (b.Action === "recycle" ? "Only closed contacts can be recycled" : null) } });
    render();
    const user = userEvent.setup();
    await screen.findByText("Mrs. HARJEET KAUR");
    tick("Mrs. HARJEET KAUR");
    await user.click(screen.getByTestId("bulk-recall"));
    await user.click(screen.getByTestId("action-confirm"));
    await waitFor(() => expect(cap.recall).toMatchObject({ CallListId: 5, ContactIds: [101] }));
    const fetches = cap.calls.fetchContacts.length;
    await waitFor(() => expect(cap.calls.fetchContacts.length).toBeGreaterThan(fetches - 1));
    tick("Mrs. SUNITA BAKSHI");
    await user.click(screen.getByTestId("bulk-remove"));
    expect(screen.getByText(/closed as removed/)).toBeInTheDocument();
    await user.click(screen.getByTestId("action-confirm"));
    await waitFor(() => expect(cap.setState).toMatchObject({ Action: "remove", ContactIds: [103] }));
    tick("Mrs. SUNITA BAKSHI");
    await user.click(screen.getByTestId("bulk-recycle"));
    await user.click(screen.getByTestId("action-confirm"));
    expect(await screen.findByTestId("action-error")).toHaveTextContent("Only closed contacts can be recycled");
  });

  it("disables the bulk buttons above 500 ticked", async () => {
    const many = Array.from({ length: 501 }, (_, i) => contactRow({ Id: 1000 + i, Name: `P${i}`, Mobile: String(9000000000 + i) }));
    mockCallingEndpoints({ contacts: many });
    renderWithProviders(<ContactsTab list={listRow()} callers={[]} />);
    await screen.findByText("P0");
    const all = screen.getAllByRole("checkbox")[0];
    fireEvent.click(all);
    expect(await screen.findByText("Select 500 or fewer")).toBeInTheDocument();
    expect(screen.getByTestId("bulk-give")).toBeDisabled();
    expect(screen.queryByTestId("add-contact-btn")).toBeNull();
  });

  it("adds a contact by hand and shows the server's reason when refused", async () => {
    const cap = mockCallingEndpoints({ contacts: ROWS, fail: { addContact: "Already a lead" } });
    render();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("add-contact-btn"));
    await user.type(screen.getByTestId("add-Name"), "New One");
    await user.type(screen.getByTestId("add-Mobile"), "9898011111");
    await user.type(screen.getByTestId("add-City"), "Delhi");
    await user.click(screen.getByTestId("add-save"));
    expect(await screen.findByTestId("add-error")).toHaveTextContent("Already a lead");
    expect(cap.addContact).toMatchObject({ CallListId: 5, Name: "New One", Mobile: "9898011111", City: "Delhi", AltMobile: null });
  });

  it("opens the call history newest first, saying when a result was saved without dialling", async () => {
    mockCallingEndpoints({
      contacts: ROWS,
      history: {
        contact: contactRow({ Extra: '{"Ref No.":"MLSS-0001"}', Attempts: 2 }),
        attempts: [
          { Id: 9, Result: "callback", Notes: "Call at 4", DialedAt: null, CalledAt: "2026-11-24T11:05:00", CallbackAt: "2026-11-24T16:00:00", UserName: "Rohit Sharma" },
          { Id: 8, Result: "no_answer", Notes: null, DialedAt: "2026-11-23T16:09:00", CalledAt: "2026-11-23T16:10:00", UserName: "Rohit Sharma" },
        ],
      },
    });
    render();
    const user = userEvent.setup();
    await user.click(await screen.findByText("Mrs. HARJEET KAUR"));
    const drawer = await screen.findByTestId("contact-drawer");
    expect(await within(drawer).findByTestId("attempt-9")).toHaveTextContent("Call back");
    expect(within(drawer).getByTestId("attempt-9")).toHaveTextContent("saved without dialling");
    expect(within(drawer).getByTestId("attempt-8")).not.toHaveTextContent("saved without dialling");
    expect(within(drawer).getByText("MLSS-0001")).toBeInTheDocument();
    const ids = within(drawer).getAllByTestId(/^attempt-/).map((e) => e.dataset.testid);
    expect(ids).toEqual(["attempt-9", "attempt-8"]);
  });

  it("history: a closed contact with its reason, an undone call, a kept callback, bad extras, and a contact out of view", async () => {
    mockCallingEndpoints({
      contacts: ROWS,
      history: {
        contact: contactRow({ Status: "closed", CloseReason: "no_response", Extra: "not json", HeldByName: null }),
        attempts: [{ Id: 7, Result: "callback", DialedAt: "2026-11-23T10:00:00", CalledAt: "2026-11-23T10:01:00", CallbackAt: "2026-11-23T16:00:00", CallbackOutcome: "kept", UndoneAt: "2026-11-23T10:02:00", UserName: "Rohit Sharma" }],
      },
    });
    render();
    const user = userEvent.setup();
    await user.click(await screen.findByText("Mrs. HARJEET KAUR"));
    const drawer = await screen.findByTestId("contact-drawer");
    expect(await within(drawer).findByText("No response")).toBeInTheDocument();
    expect(within(drawer).getByTestId("attempt-7")).toHaveTextContent("Call back (undone)");
    expect(within(drawer).getByTestId("attempt-7")).toHaveTextContent("· kept");
  });

  it("history: a contact with no calls, and one the server will not show", async () => {
    mockCallingEndpoints({ contacts: ROWS, history: { contact: contactRow(), attempts: [] } });
    render();
    const user = userEvent.setup();
    await user.click(await screen.findByText("Mrs. HARJEET KAUR"));
    expect(await screen.findByText("Not called yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    mockCallingEndpoints({ contacts: ROWS, fail: { contactHistory: { message: "Contact not found", status: 404 } } });
    await user.click(screen.getByText("Mr. RAJINDER SINGH BEDI"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Contact not found");
  });
});
