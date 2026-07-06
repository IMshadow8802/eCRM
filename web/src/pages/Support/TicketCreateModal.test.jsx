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
}));

vi.mock("../../hooks/useApiMutation", () => ({
  useApiMutation: vi.fn(() => ({ mutateAsync, isPending: false })),
}));

vi.mock("../../hooks/useApiQuery", () => ({
  useApiQuery: vi.fn((cfg) => {
    if (cfg?.endpoint === "/api/config/fetchPipelines") {
      return {
        data: {
          pipelines: [{ Id: 9, Name: "Support", IsDefault: true }],
          stages: [
            { Id: 3, PipelineId: 9, Name: "Open", SortOrder: 1 },
            { Id: 4, PipelineId: 9, Name: "Resolved", SortOrder: 2 },
          ],
        },
      };
    }
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
import { useApiQuery } from "../../hooks/useApiQuery";

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

  it("defaults pipeline + stage from the default pipeline's first stage", async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByTestId("ticket-pipeline-input")).toHaveValue("Support");
      expect(screen.getByTestId("ticket-stage-input")).toHaveValue("Open");
    });
  });

  it("submits saveTicket with Id:0 and the ticket-insert shape (happy path)", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const onClose = vi.fn();
    renderModal({ onCreated, onClose });

    await user.type(screen.getByTestId("ticket-customer"), "Acme Corp");
    await user.type(screen.getByTestId("ticket-contact"), "9990001111");
    await pickOption(user, "ticket-pipeline", "Support"); // fires onChange → re-defaults stage
    await pickOption(user, "ticket-channel", "Email");
    await pickOption(user, "ticket-category", "Billing");
    await pickOption(user, "ticket-priority", "High");
    await pickOption(user, "ticket-assignee", "Bob");
    await user.type(screen.getByTestId("ticket-description"), "Cannot log in");

    await waitFor(() => expect(screen.getByTestId("ticket-stage-input")).toHaveValue("Open"));
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
      PipelineId: 9,
      StageId: 3,
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

  it("sends nulls for optional fields left blank (only Customer set)", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByTestId("ticket-customer"), "Solo Co");
    await waitFor(() => expect(screen.getByTestId("ticket-stage-input")).toHaveValue("Open"));
    await user.click(screen.getByTestId("create-ticket-submit"));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({
      Id: 0,
      CustomerName: "Solo Co",
      Contact: null,
      Channel: null,
      CategoryId: null,
      Priority: null,
      AssignedTo: null,
      LinkedLeadId: null,
      Description: null,
      PipelineId: 9,
      StageId: 3,
    });
  });

  it("keeps the modal open when saveTicket fails", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mutateAsync.mockRejectedValueOnce(new Error("boom"));
    renderModal({ onClose });
    await user.type(screen.getByTestId("ticket-customer"), "Acme");
    await waitFor(() => expect(screen.getByTestId("ticket-stage-input")).toHaveValue("Open"));
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

  it("blocks submit until Customer is filled (validation edge)", async () => {
    const user = userEvent.setup();
    renderModal();
    expect(screen.getByTestId("create-ticket-submit")).toBeDisabled();
    await user.click(screen.getByTestId("create-ticket-submit"));
    expect(mutateAsync).not.toHaveBeenCalled();

    await user.type(screen.getByTestId("ticket-customer"), "Acme");
    expect(screen.getByTestId("create-ticket-submit")).not.toBeDisabled();
  });

  // Kept last: permanently overrides the useApiQuery mock impl.
  it("sends null pipeline/stage when no pipelines are configured", async () => {
    const user = userEvent.setup();
    useApiQuery.mockImplementation((cfg) => {
      if (cfg?.endpoint === "/api/config/fetchPipelines") {
        return { data: { pipelines: [], stages: [] } };
      }
      if (cfg?.endpoint === "/api/config/fetchCustomFields") return { data: { customFields: [] } };
      return { data: { lookups: [] } };
    });
    renderModal();
    await user.type(screen.getByTestId("ticket-customer"), "No Pipeline Co");
    await user.click(screen.getByTestId("create-ticket-submit"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({ PipelineId: null, StageId: null });
  });
});
