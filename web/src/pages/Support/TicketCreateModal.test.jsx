import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import dayjs from "dayjs";

import TicketCreateModal from "./TicketCreateModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import {
  json, refuse, ticketRow, ticketDetail, customerRow,
  mockSupportRefData, mockTicketEndpoints, mockCustomerEndpoints,
} from "../../test/supportMocks";

const DEFS = [
  { Id: 55, Label: "Account #", Type: "text", Options: null, IsRequired: false, SortOrder: 1 },
  { Id: 56, Label: "VIP", Type: "checkbox", Options: null, IsRequired: false, SortOrder: 2 },
  { Id: 57, Label: "Tier", Type: "dropdown", Options: '["A","B"]', IsRequired: false, SortOrder: 3 },
];
const mockDefs = (defs = DEFS) =>
  server.use(http.post("*/api/config/fetchCustomFields", () => json({ customFields: defs })));

const renderModal = (props = {}) =>
  renderWithProviders(<TicketCreateModal open onClose={vi.fn()} onSaved={vi.fn()} {...props} />, { router: false });

const pick = async (user, testId, name) => {
  await user.click(screen.getByTestId(`${testId}-input`));
  await user.click(await screen.findByRole("option", { name }));
};

describe("TicketCreateModal — create", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM" });
    mockSupportRefData();
    mockCustomerEndpoints({}, { customers: [customerRow()] });
  });

  it("posts the whole sp_SaveTicket shape with Id 0 and nothing from the stage era", async () => {
    const cap = mockTicketEndpoints();
    mockDefs();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderModal({ onSaved, onClose });
    const user = userEvent.setup();

    await pick(user, "customer-picker", "Acme Corp · 9990001111");
    await user.type(screen.getByTestId("ticket-subject"), "  Screen flickers on boot ");
    await pick(user, "ticket-category", "Billing");
    await pick(user, "ticket-priority", "High");
    await pick(user, "ticket-channel", "Phone");
    await pick(user, "ticket-product", "Gold Chain 22K");
    await pick(user, "ticket-assignee", "Sara Khan");
    await user.type(screen.getByTestId("ticket-description"), "Flickers for a minute after power-on.");
    await user.click(screen.getByTestId("create-ticket-submit"));

    await waitFor(() => expect(cap.save).toBeTruthy());
    expect(cap.save).toEqual({
      Id: 0, CustomerId: 3, Subject: "Screen flickers on boot",
      ContactPerson: "Gurpreet", Contact: "9990001111",
      ChannelId: 71, CategoryId: 6, Priority: 3, ProductId: 1,
      AssignedTo: 18, LinkedLeadId: null,
      Description: "Flickers for a minute after power-on.",
      CustomJSON: JSON.stringify([
        { fieldId: 55, type: "text", value: "" },
        { fieldId: 56, type: "checkbox", value: false },
        { fieldId: 57, type: "dropdown", value: null },
      ]),
    });
    // CompId/BranchId/UserId are injected server-side; the lifecycle is the
    // SP's (first 'open' status) and the pipeline engine is gone.
    for (const key of ["CompId", "UserId", "StatusId", "PipelineId", "StageId", "CustomerName", "Channel"]) {
      expect(cap.save).not.toHaveProperty(key);
    }
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ Id: 909, TicketNo: "TKT-0909" }));
    expect(onClose).toHaveBeenCalled();
  }, 20000);

  it("refuses without a customer, then without a subject", async () => {
    const cap = mockTicketEndpoints();
    renderModal();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("create-ticket-submit"));
    expect(await screen.findByText("Pick a customer")).toBeInTheDocument();
    expect(cap.save).toBeUndefined();

    await pick(user, "customer-picker", "Acme Corp · 9990001111");
    await user.click(screen.getByTestId("create-ticket-submit"));
    expect(await screen.findByText("Subject is required")).toBeInTheDocument();
    expect(cap.save).toBeUndefined();

    await user.type(screen.getByTestId("ticket-subject"), "Invoice mismatch");
    await user.click(screen.getByTestId("create-ticket-submit"));
    await waitFor(() => expect(cap.save).toMatchObject({ Id: 0, CustomerId: 3, Subject: "Invoice mismatch" }));
    // Everything else is optional — sp_SaveTicket takes NULL for all of it.
    expect(cap.save).toMatchObject({ CategoryId: null, Priority: null, ChannelId: null, ProductId: null, AssignedTo: null, Description: null });
  }, 20000);

  // Spec §4: "Reported by (prefilled from the customer)". The agent should not
  // retype what tblCustomer already knows.
  it("picking a customer prefills Reported by from that customer", async () => {
    mockTicketEndpoints();
    mockCustomerEndpoints({}, { customers: [customerRow(), customerRow({ Id: 4, Name: "Zenith Traders", ContactPerson: "Meera", Mobile: null, Email: "zen@example.com" })] });
    renderModal();
    const user = userEvent.setup();

    await pick(user, "customer-picker", "Acme Corp · 9990001111");
    expect(screen.getByTestId("ticket-contact-person")).toHaveValue("Gurpreet");
    expect(screen.getByTestId("ticket-contact")).toHaveValue("9990001111");

    // A different customer means a different person — the old values go.
    await pick(user, "customer-picker", "Zenith Traders · zen@example.com");
    expect(screen.getByTestId("ticket-contact-person")).toHaveValue("Meera");
    expect(screen.getByTestId("ticket-contact")).toHaveValue("zen@example.com");
  }, 20000);

  // Spec §4: "Priority (shows 'due by')" — the priority IS the due date, and
  // an agent picking one should see what they just promised.
  it("shows the due date the picked priority will stamp", async () => {
    mockTicketEndpoints();
    renderModal();
    const user = userEvent.setup();

    expect(screen.getByText("The priority sets the due date")).toBeInTheDocument();
    await pick(user, "ticket-priority", "High");              // TatHours 24
    expect(await screen.findByText(new RegExp(`Due by ${dayjs().add(24, "hour").format("DD-MM-YYYY")}`))).toBeInTheDocument();
    await pick(user, "ticket-priority", "Low");               // TatHours 168
    expect(await screen.findByText(new RegExp(`Due by ${dayjs().add(168, "hour").format("DD-MM-YYYY")}`))).toBeInTheDocument();
  });

  it("keeps the modal open and shows the server's refusal", async () => {
    mockTicketEndpoints();
    server.use(http.post("*/api/tickets/saveTicket", () => refuse("Customer not found", 404)));
    const onClose = vi.fn();
    renderModal({ onClose });
    const user = userEvent.setup();

    await pick(user, "customer-picker", "Acme Corp · 9990001111");
    await user.type(screen.getByTestId("ticket-subject"), "Invoice mismatch");
    await user.click(screen.getByTestId("create-ticket-submit"));

    expect(await screen.findByText("Customer not found")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-ticket-modal")).toBeInTheDocument();
  }, 20000);

  it("Cancel closes without saving, discarding whatever was typed", async () => {
    const cap = mockTicketEndpoints();
    const onClose = vi.fn();
    renderModal({ onClose });
    const user = userEvent.setup();

    await pick(user, "customer-picker", "Acme Corp · 9990001111");
    await user.type(screen.getByTestId("ticket-subject"), "Invoice mismatch");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(cap.save).toBeUndefined();
  });

  // handleClose's own isPending guard — the Cancel button is disabled while
  // saving, but the header's X, the backdrop and Escape all route through
  // Modal's onClose regardless, so the guard is what stops those from
  // yanking the modal away mid-request.
  it("ignores a close while the save is still in flight", async () => {
    let release;
    server.use(
      http.post(
        "*/api/tickets/saveTicket",
        () =>
          new Promise((resolve) => {
            release = () => resolve(json({ Id: 909, TicketNo: "TKT-0909", ResponseCode: 200, ResponseMess: "Saved" }));
          }),
      ),
    );
    const onClose = vi.fn();
    renderModal({ onClose });
    const user = userEvent.setup();

    await pick(user, "customer-picker", "Acme Corp · 9990001111");
    await user.type(screen.getByTestId("ticket-subject"), "Invoice mismatch");
    await user.click(screen.getByTestId("create-ticket-submit"));

    await waitFor(() => expect(screen.getByTestId("create-ticket-submit")).toBeDisabled());
    await user.click(screen.getByTestId("modal-close"));
    expect(onClose).not.toHaveBeenCalled();

    release();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  }, 20000);
});

describe("TicketCreateModal — edit", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM" });
    mockSupportRefData();
    mockCustomerEndpoints({}, { customers: [customerRow()] });
  });

  it("prefills every field, posts the Id, and never sends AssignedTo or a status", async () => {
    const cap = mockTicketEndpoints({}, {
      detail: ticketDetail({ fields: [{ FieldId: 55, FieldKey: "acct", Label: "Account #", Type: "text", ValueText: "ACC-1", ValueNumber: null, ValueDate: null }] }),
    });
    mockDefs();
    const onSaved = vi.fn();
    renderModal({ ticket: ticketRow({ LinkedLeadId: 11 }), onSaved });
    const user = userEvent.setup();

    expect(screen.getByText("Edit complaint")).toBeInTheDocument();
    expect(screen.getByTestId("customer-picker-input")).toHaveValue("Acme Corp · 9990001111");
    expect(screen.getByTestId("ticket-subject")).toHaveValue("Screen flickers on boot");
    expect(screen.getByTestId("ticket-category-input")).toHaveValue("Billing");
    expect(screen.getByTestId("ticket-priority-input")).toHaveValue("High");
    expect(screen.getByTestId("ticket-channel-input")).toHaveValue("Phone");
    expect(screen.getByTestId("ticket-contact-person")).toHaveValue("Gurpreet");
    expect(screen.getByTestId("ticket-description")).toHaveValue("Flickers for a minute after power-on.");
    // The stored custom value arrives with the detail, not with the row.
    expect(await screen.findByLabelText("Account #")).toHaveValue("ACC-1");

    await user.clear(screen.getByTestId("ticket-subject"));
    await user.type(screen.getByTestId("ticket-subject"), "Screen flickers and clicks");
    await user.click(screen.getByTestId("create-ticket-submit"));

    await waitFor(() => expect(cap.save).toBeTruthy());
    expect(cap.save).toMatchObject({
      Id: 7, CustomerId: 3, Subject: "Screen flickers and clicks",
      CategoryId: 6, Priority: 3, ChannelId: 71, LinkedLeadId: 11,
    });
    // Transfer is the only way to move a complaint; the status dropdown is the
    // only way to move its lifecycle. Neither belongs in a save.
    expect(cap.save).not.toHaveProperty("AssignedTo");
    expect(cap.save).not.toHaveProperty("StatusId");
    expect(JSON.parse(cap.save.CustomJSON)).toEqual([
      { fieldId: 55, type: "text", value: "ACC-1" },
      { fieldId: 56, type: "checkbox", value: false },
      { fieldId: 57, type: "dropdown", value: null },
    ]);
    expect(onSaved).toHaveBeenCalled();
  }, 20000);

  it("hides the assignee picker and the attachments panel", async () => {
    mockTicketEndpoints();
    renderModal({ ticket: ticketRow() });
    expect(await screen.findByTestId("ticket-subject")).toBeInTheDocument();
    expect(screen.queryByTestId("ticket-assignee-input")).toBeNull();
    expect(screen.queryByTestId("ticket-attachments")).toBeNull();
  });

  it("says what changing the priority does to the due date", async () => {
    mockTicketEndpoints();
    renderModal({ ticket: ticketRow() });   // Priority 3 (High), DueAt 2026-09-16
    const user = userEvent.setup();

    expect(await screen.findByText(/^Due 16-09-2026/)).toBeInTheDocument();
    await pick(user, "ticket-priority", "Low");
    expect(await screen.findByText("Due date re-stamped to 168h from when it was raised")).toBeInTheDocument();
  });
});
