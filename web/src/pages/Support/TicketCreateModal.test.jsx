import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@mui/material/styles";

import { buildTheme } from "../../theme";

const FIXTURE_USERS = [
  { Id: 1, Username: "alice", FullName: "Alice" },
  { Id: 2, Username: "bob", FullName: "Bob" },
];

// Custom-field defs spanning types so CustomJSON + blank-seeding cover each.
const FIXTURE_DEFS = [
  { Id: 55, Label: "Account #", Type: "text", IsRequired: false },
  { Id: 56, Label: "VIP", Type: "checkbox", IsRequired: false },
  { Id: 57, Label: "Tier", Type: "dropdown", Options: '["A","B"]', IsRequired: false },
];

const mutateAsync = vi.fn().mockResolvedValue({ Id: 909 });

vi.mock("../../hooks", () => ({
  useUsers: vi.fn(() => ({ data: { users: FIXTURE_USERS } })),
  // Attachments (rendered inside the modal) pulls useConfirmation.
  useConfirmation: vi.fn(() => ({
    confirmationState: { open: false },
    showConfirmation: vi.fn(),
    hideConfirmation: vi.fn(),
    handleConfirm: vi.fn(),
    confirmDelete: vi.fn(),
  })),
}));

vi.mock("../../hooks/useApiMutation", () => ({
  useApiMutation: vi.fn(() => ({ mutateAsync, isPending: false })),
}));

vi.mock("../../hooks/useApiQuery", () => ({
  useApiQuery: vi.fn((cfg) => {
    if (cfg?.endpoint === "/api/config/fetchCustomFields") {
      return { data: { customFields: FIXTURE_DEFS } };
    }
    if (cfg?.params?.Kind === "priority") {
      return { data: { lookups: [{ Id: 7, Value: "High" }, { Id: 8, Value: "Low" }] } };
    }
    // ticket_category
    return { data: { lookups: [{ Id: 5, Value: "Billing" }, { Id: 6, Value: "Technical" }] } };
  }),
}));

import TicketCreateModal from "./TicketCreateModal";

const renderModal = (props = {}) =>
  render(
    <ThemeProvider theme={buildTheme("light")}>
      <QueryClientProvider client={new QueryClient()}>
        <TicketCreateModal open onClose={vi.fn()} onCreated={vi.fn()} {...props} />
      </QueryClientProvider>
    </ThemeProvider>
  );

const pickOption = async (user, testId, optionName) => {
  await user.click(screen.getByTestId(`${testId}-input`));
  await user.click(await screen.findByRole("option", { name: optionName }));
};

// Fill every mandatory field (Customer/Contact/Channel/Category/Priority/
// Description). Individual tests then poke holes in it.
const fillRequired = async (user) => {
  await user.type(screen.getByTestId("ticket-customer"), "Acme Corp");
  await user.type(screen.getByTestId("ticket-contact"), "9990001111");
  await pickOption(user, "ticket-channel", "Email");
  await pickOption(user, "ticket-category", "Billing");
  await pickOption(user, "ticket-priority", "High");
  await user.type(screen.getByTestId("ticket-description"), "Cannot log in");
};

describe("TicketCreateModal", () => {
  beforeEach(() => {
    mutateAsync.mockClear();
  });

  it("renders the create form when open", () => {
    renderModal();
    expect(screen.getByTestId("create-ticket-modal")).toBeInTheDocument();
    expect(screen.getByTestId("ticket-customer")).toBeInTheDocument();
    expect(screen.getByText("Account #")).toBeInTheDocument(); // custom field rendered
  });

  // Stage is the lifecycle's source of truth: a new ticket always starts at
  // the server-defaulted first open stage, so the form offers no pipeline or
  // stage pickers at all (also two fewer jargon dropdowns).
  it("offers no pipeline/stage pickers — the server defaults both", () => {
    renderModal();
    expect(screen.queryByTestId("ticket-pipeline")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ticket-stage")).not.toBeInTheDocument();
  });

  it("submits saveTicket with Id:0 and the ticket-insert shape (happy path)", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const onClose = vi.fn();
    renderModal({ onCreated, onClose });

    await fillRequired(user);
    await pickOption(user, "ticket-assignee", "Bob");
    await user.click(screen.getByTestId("create-ticket-submit"));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mutateAsync.mock.calls[0][0];
    expect(payload).toMatchObject({
      Id: 0,
      CustomerName: "Acme Corp",
      Contact: "9990001111",
      Channel: "email",
      CategoryId: 5,
      Priority: 7,
      PipelineId: null, // server picks the default pipeline
      StageId: null, // server picks the first open stage
      AssignedTo: 2,
      LinkedLeadId: null,
      Description: "Cannot log in",
    });
    // CompId/BranchId/UserId are injected server-side — never sent from the client.
    expect(payload).not.toHaveProperty("CompId");
    expect(payload).not.toHaveProperty("UserId");
    // Custom fields serialized into CustomJSON, blank-seeded per type.
    expect(JSON.parse(payload.CustomJSON)).toEqual([
      { fieldId: 55, type: "text", value: "" },
      { fieldId: 56, type: "checkbox", value: false },
      { fieldId: 57, type: "dropdown", value: null },
    ]);
    expect(onCreated).toHaveBeenCalledWith({ Id: 909 });
    expect(onClose).toHaveBeenCalled();
  });

  // A complaint without contact/channel/category/priority/description is an
  // unactionable record — the form must refuse it, not the server.
  it("blocks submit until every mandatory field is filled", async () => {
    const user = userEvent.setup();
    renderModal();
    const submit = screen.getByTestId("create-ticket-submit");

    expect(submit).toBeDisabled();

    await user.type(screen.getByTestId("ticket-customer"), "Acme");
    expect(submit).toBeDisabled(); // customer alone is not enough any more

    await user.type(screen.getByTestId("ticket-contact"), "9990001111");
    await pickOption(user, "ticket-channel", "Email");
    await pickOption(user, "ticket-category", "Billing");
    await pickOption(user, "ticket-priority", "High");
    expect(submit).toBeDisabled(); // description still missing

    await user.type(screen.getByTestId("ticket-description"), "It broke");
    expect(submit).not.toBeDisabled();

    // Assignee stays optional.
    await user.click(submit);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({ AssignedTo: null });
  });

  it("keeps the modal open when saveTicket fails", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mutateAsync.mockRejectedValueOnce(new Error("boom"));
    renderModal({ onClose });
    await fillRequired(user);
    await user.click(screen.getByTestId("create-ticket-submit"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes without saving when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
