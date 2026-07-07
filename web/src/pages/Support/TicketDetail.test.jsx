import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import TicketDetail from "./TicketDetail";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const TICKET = {
  Id: 7,
  TicketNo: "TKT-0007",
  CustomerName: "Acme Corp",
  Contact: "9999999999",
  Channel: "email",
  CategoryId: 4,
  Priority: 2,
  PipelineId: 9,
  StageId: 3,
  AssignedTo: 2,
  LinkedLeadId: 11,
  SLADueAt: "2026-07-10T10:00:00Z",
  ResolvedAt: null,
  ClosedAt: null,
  ResolutionId: null,
  Description: "Login broken",
  IsBreached: false,
  CreatedAt: "2026-07-01T10:00:00Z",
  UpdatedAt: "2026-07-01T10:00:00Z",
};

const FIELDS = [
  {
    FieldId: 1,
    Label: "Severity",
    Type: "number",
    Options: null,
    IsRequired: false,
    ValueText: null,
    ValueNumber: 3,
    ValueDate: null,
  },
  {
    FieldId: 2,
    Label: "Module",
    Type: "dropdown",
    Options: JSON.stringify(["Auth", "Billing"]),
    IsRequired: false,
    ValueText: "Auth",
    ValueNumber: null,
    ValueDate: null,
  },
];

const ACTIVITY = [
  { Id: 2, TicketId: 7, UserId: 2, Type: "stage_changed", CreatedAt: "2026-01-02T10:00:00Z", Summary: "Moved to In Progress", MetaJSON: null },
  { Id: 1, TicketId: 7, UserId: 2, Type: "created", CreatedAt: "2026-01-01T10:00:00Z", Summary: null, MetaJSON: null },
];

const LINKED_LEAD = { Id: 11, Name: "Acme Corp", MobileNo: "9999999999", Email: "acme@example.com", StageId: 3 };

const toDefs = (fields) =>
  fields.map((f, i) => ({
    Id: f.FieldId,
    Label: f.Label,
    Type: f.Type,
    Options: f.Options,
    IsRequired: f.IsRequired,
    SortOrder: i,
  }));

const toValues = (fields) =>
  fields.map((f) => ({
    FieldId: f.FieldId,
    ValueText: f.ValueText,
    ValueNumber: f.ValueNumber,
    ValueDate: f.ValueDate,
  }));

const LOOKUPS = {
  priority: [{ Id: 2, Value: "High" }],
  ticket_category: [{ Id: 4, Value: "Billing" }],
  resolution: [{ Id: 5, Value: "Fixed" }],
};

const mockDetail = ({ ticket = TICKET, fields = FIELDS, activity = ACTIVITY, linkedLead = LINKED_LEAD } = {}) =>
  server.use(
    http.post("*/api/tickets/fetchTicketDetail", async () =>
      HttpResponse.json({
        success: true,
        message: "ok",
        responseCode: 200,
        data: { ticket, fields: toValues(fields), activity, linkedLead },
      }),
    ),
    http.post("*/api/config/fetchCustomFields", async () =>
      HttpResponse.json({
        success: true,
        message: "ok",
        responseCode: 200,
        data: { customFields: toDefs(fields) },
      }),
    ),
    http.post("*/api/users/fetchUsers", async () =>
      HttpResponse.json({
        success: true,
        responseCode: 200,
        data: { users: [{ Id: 2, FullName: "Bob", Username: "bob" }] },
      }),
    ),
    // fetchLookups is keyed by Kind — branch on the request body so
    // priority/category/resolution each get their own list.
    http.post("*/api/config/fetchLookups", async ({ request }) => {
      const { Kind } = await request.json();
      return HttpResponse.json({
        success: true,
        responseCode: 200,
        data: { lookups: LOOKUPS[Kind] ?? [] },
      });
    }),
    http.post("*/api/config/fetchPipelines", async () =>
      HttpResponse.json({
        success: true,
        responseCode: 200,
        data: {
          pipelines: [{ Id: 9, Name: "Support", IsDefault: true }],
          stages: [{ Id: 3, PipelineId: 9, Name: "In Progress" }],
        },
      }),
    ),
  );

const mockSaveTicket = (capture) =>
  server.use(
    http.post("*/api/tickets/saveTicket", async ({ request }) => {
      const body = await request.json();
      capture?.(body);
      return HttpResponse.json({
        success: true,
        message: "Saved",
        responseCode: 200,
        data: { Id: 7, ResponseCode: 200, ResponseMess: "Saved" },
      });
    }),
  );

const mockAction = (endpoint, capture) =>
  server.use(
    http.post(`*${endpoint}`, async ({ request }) => {
      const body = await request.json();
      capture?.(body);
      return HttpResponse.json({
        success: true,
        message: "ok",
        responseCode: 200,
        data: { ResponseCode: 200, ResponseMess: "ok" },
      });
    }),
  );

describe("TicketDetail", () => {
  beforeEach(() => {
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      UserId: 1,
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
    mockSaveTicket();
  });

  it("renders the ticket header with number, customer, resolved stage and SLA due date", async () => {
    mockDetail();
    renderWithProviders(<TicketDetail ticketId={7} />, { router: false });
    expect(await screen.findByText("TKT-0007")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByTestId("ticket-stage-chip")).toHaveTextContent("In Progress");
    expect(screen.getByTestId("ticket-sla-chip")).toHaveTextContent("10-07-2026");
  });

  it("shows a red Breached SLA chip when the ticket is breached", async () => {
    mockDetail({ ticket: { ...TICKET, IsBreached: true } });
    renderWithProviders(<TicketDetail ticketId={7} />, { router: false });
    await screen.findByText("TKT-0007");
    expect(screen.getByTestId("ticket-sla-chip")).toHaveTextContent("Breached");
  });

  it("renders custom fields via DynamicField populated with their current values", async () => {
    mockDetail();
    renderWithProviders(<TicketDetail ticketId={7} />, { router: false });
    await screen.findByText("TKT-0007");
    expect(screen.getByLabelText("Severity")).toHaveValue(3);
    expect(screen.getByLabelText("Module")).toBeInTheDocument();
  });

  it("links to the linked lead", async () => {
    mockDetail();
    renderWithProviders(<TicketDetail ticketId={7} />, { router: false });
    await screen.findByText("TKT-0007");
    const link = screen.getByTestId("linked-lead-link");
    expect(link).toHaveAttribute("href", "/sales/leads/11");
  });

  it("omits the linked-lead link when there is no linked lead", async () => {
    mockDetail({ linkedLead: null });
    renderWithProviders(<TicketDetail ticketId={7} />, { router: false });
    await screen.findByText("TKT-0007");
    expect(screen.queryByTestId("linked-lead-link")).not.toBeInTheDocument();
  });

  it("Timeline tab lists activity chronologically", async () => {
    mockDetail();
    renderWithProviders(<TicketDetail ticketId={7} />, { router: false });
    await screen.findByText("TKT-0007");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Timeline/i }));
    const items = await screen.findAllByTestId("timeline-item");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Created");
    expect(items[1]).toHaveTextContent("Stage changed");
  });

  it("shows Resolve/Close when the ticket is open and Reopen is hidden", async () => {
    mockDetail();
    renderWithProviders(<TicketDetail ticketId={7} />, { router: false });
    await screen.findByText("TKT-0007");
    expect(screen.getByTestId("resolve-btn")).toBeInTheDocument();
    expect(screen.getByTestId("close-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("reopen-btn")).not.toBeInTheDocument();
  });

  it("shows Reopen when the ticket has been resolved", async () => {
    mockDetail({ ticket: { ...TICKET, ResolvedAt: "2026-07-05T10:00:00Z" } });
    renderWithProviders(<TicketDetail ticketId={7} />, { router: false });
    await screen.findByText("TKT-0007");
    expect(screen.getByTestId("reopen-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("resolve-btn")).not.toBeInTheDocument();
  });

  it("Resolve modal requires a resolution and submits resolveTicket with the picked ResolutionId", async () => {
    let captured;
    mockDetail();
    mockAction("/api/tickets/resolveTicket", (body) => {
      captured = body;
    });
    renderWithProviders(<TicketDetail ticketId={7} />, { router: false });
    await screen.findByText("TKT-0007");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("resolve-btn"));

    const submit = await screen.findByTestId("resolve-submit");
    expect(submit).toBeDisabled();

    await user.click(screen.getByTestId("resolution-combobox-input"));
    await user.click(await screen.findByText("Fixed"));

    expect(submit).not.toBeDisabled();
    await user.click(submit);

    await waitFor(() => expect(captured).toBeTruthy());
    expect(captured).toEqual(expect.objectContaining({ TicketId: 7, ResolutionId: 5 }));
  });

  it("Close action submits closeTicket with the ticket id", async () => {
    let captured;
    mockDetail();
    mockAction("/api/tickets/closeTicket", (body) => {
      captured = body;
    });
    renderWithProviders(<TicketDetail ticketId={7} />, { router: false });
    await screen.findByText("TKT-0007");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("close-btn"));
    await waitFor(() => expect(captured).toBeTruthy());
    expect(captured).toEqual(expect.objectContaining({ TicketId: 7 }));
  });

  it("Reopen action submits reopenTicket with the ticket id", async () => {
    let captured;
    mockDetail({ ticket: { ...TICKET, ClosedAt: "2026-07-05T10:00:00Z" } });
    mockAction("/api/tickets/reopenTicket", (body) => {
      captured = body;
    });
    renderWithProviders(<TicketDetail ticketId={7} />, { router: false });
    await screen.findByText("TKT-0007");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("reopen-btn"));
    await waitFor(() => expect(captured).toBeTruthy());
    expect(captured).toEqual(expect.objectContaining({ TicketId: 7 }));
  });

  it("editing a custom field and saving posts saveTicket with an updated CustomJSON", async () => {
    let captured;
    mockDetail();
    mockSaveTicket((body) => {
      captured = body;
    });
    renderWithProviders(<TicketDetail ticketId={7} />, { router: false });
    await screen.findByText("TKT-0007");

    const user = userEvent.setup();
    const input = screen.getByLabelText("Severity");
    await user.clear(input);
    await user.type(input, "5");

    const saveBtn = screen.getByTestId("save-custom-fields-btn");
    expect(saveBtn).not.toBeDisabled();
    await user.click(saveBtn);

    await waitFor(() => expect(captured).toBeTruthy());
    expect(captured.Id).toBe(7);
    const customJson = JSON.parse(captured.CustomJSON);
    expect(customJson).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldId: 1, type: "number", value: "5" }),
        expect.objectContaining({ fieldId: 2, type: "dropdown", value: "Auth" }),
      ]),
    );
  });

  it("Log Call button opens the LogCallModal", async () => {
    mockDetail();
    renderWithProviders(<TicketDetail ticketId={7} />, { router: false });
    await screen.findByText("TKT-0007");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("log-call-btn"));
    expect(await screen.findByTestId("log-call-modal")).toBeInTheDocument();
  });

  it("renders a loading skeleton before the ticket has loaded", () => {
    mockDetail();
    renderWithProviders(<TicketDetail ticketId={7} />, { router: false });
    expect(screen.getByTestId("ticket-detail-loading")).toBeInTheDocument();
  });
});
