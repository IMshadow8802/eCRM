import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, configure } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

// Cold-start module transform makes the first render in this file slow;
// RTL's default 1000ms findBy window can elapse before React Query settles.
configure({ asyncUtilTimeout: 5000 });

import TicketBoard from "./TicketBoard";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

// dnd-kit's real drag lifecycle needs pointer/keyboard sensors jsdom can't
// drive, so we stub the library: DragDropProvider just renders children and
// stashes onDragEnd so a test can invoke it with a hand-built event shaped
// exactly like a real @dnd-kit/react drop.
const dnd = vi.hoisted(() => ({ onDragEnd: null }));
vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: ({ children, onDragEnd }) => {
    dnd.onDragEnd = onDragEnd;
    return children;
  },
  useDroppable: () => ({ ref: () => {}, isDropTarget: false }),
}));
vi.mock("@dnd-kit/react/sortable", () => ({
  useSortable: () => ({ ref: () => {}, isDragging: false }),
}));

const PIPELINE = {
  Id: 1,
  CompId: 5,
  Entity: "ticket",
  Name: "Support Pipeline",
  IsDefault: true,
  IsActive: true,
};
const STAGES = [
  { Id: 10, CompId: 5, PipelineId: 1, Name: "Open", SortOrder: 1, StageType: "open", Color: "#3B82F6", IsActive: true },
  { Id: 20, CompId: 5, PipelineId: 1, Name: "Assigned", SortOrder: 2, StageType: "open", Color: "#8B5CF6", IsActive: true },
  { Id: 30, CompId: 5, PipelineId: 1, Name: "Resolved", SortOrder: 3, StageType: "won", Color: "#22C55E", IsActive: true },
];
const PRIORITIES = [
  { Id: 1, Value: "Low" },
  { Id: 3, Value: "High" },
];
const USERS = [{ Id: 7, FullName: "Jane Agent", Username: "jane" }];
const TICKETS = [
  { Id: 100, TicketNo: "TKT-100", CustomerName: "Acme Corp", Priority: 3, StageId: 10, AssignedTo: 7, ResolutionId: null },
  { Id: 101, TicketNo: "TKT-101", CustomerName: "Globex", Priority: 1, StageId: 20, AssignedTo: null, ResolutionId: null },
];

function mockPipelines(pipelines = [PIPELINE], stages = STAGES) {
  server.use(
    http.post("*/api/config/fetchPipelines", async () =>
      HttpResponse.json({
        success: true,
        message: "Pipelines fetched successfully",
        responseCode: 200,
        data: { pipelines, stages },
      }),
    ),
  );
}

const RESOLUTIONS = [
  { Id: 5, Value: "Fixed" },
  { Id: 6, Value: "Won't Fix" },
];

function mockLookups(lookups = PRIORITIES) {
  server.use(
    http.post("*/api/config/fetchLookups", async ({ request }) => {
      const body = await request.json();
      return HttpResponse.json({
        success: true,
        message: "Lookups fetched successfully",
        responseCode: 200,
        data: { lookups: body?.Kind === "resolution" ? RESOLUTIONS : lookups },
      });
    }),
  );
}

function mockUsers(users = USERS) {
  server.use(
    http.post("*/api/users/fetchUsers", async () =>
      HttpResponse.json({
        success: true,
        message: "Users fetched successfully",
        responseCode: 200,
        data: { users, pagination: { currentPage: 1, pageSize: 1000, totalRecords: users.length, totalPages: 1 } },
      }),
    ),
  );
}

function mockTickets(tickets = TICKETS) {
  server.use(
    http.post("*/api/tickets/fetchTickets", async () =>
      HttpResponse.json({
        success: true,
        message: "Tickets fetched successfully",
        responseCode: 200,
        data: {
          tickets,
          pagination: { currentPage: 1, pageSize: 200, totalRecords: tickets.length, totalPages: 1 },
        },
      }),
    ),
  );
}

const renderBoard = () => renderWithProviders(<TicketBoard />);

describe("TicketBoard", () => {
  beforeEach(() => {
    dnd.onDragEnd = null;
    mockPipelines();
    mockLookups();
    mockUsers();
    mockTickets();
  });

  it("renders stage columns from the default pipeline", async () => {
    renderBoard();
    expect(await screen.findByTestId("ticket-stage-10")).toBeInTheDocument();
    expect(await screen.findByText("Open")).toBeInTheDocument();
    expect(await screen.findByText("Resolved")).toBeInTheDocument();
  });

  it("falls back to the first pipeline when none is marked default", async () => {
    mockPipelines([{ ...PIPELINE, IsDefault: false }], STAGES);
    renderBoard();
    expect(await screen.findByText("Open")).toBeInTheDocument();
  });

  it("shows an empty state when no pipeline/stages are configured", async () => {
    mockPipelines([], []);
    renderBoard();
    expect(await screen.findByText(/No ticket pipeline configured/i)).toBeInTheDocument();
  });

  it("renders ticket cards grouped under the right stage with TicketNo, priority chip, and assignee", async () => {
    renderBoard();
    const cardA = await screen.findByTestId("ticket-card-100");
    expect(cardA).toHaveTextContent("TKT-100");
    expect(cardA).toHaveTextContent("Acme Corp");
    // Priority id 3 resolved to "High" via lookups.
    expect(await screen.findByTestId("ticket-priority-100")).toHaveTextContent("High");
    // Assignee resolved from users list.
    expect(cardA).toHaveTextContent("Jane Agent");
    expect(screen.getByTestId("ticket-stage-10")).toContainElement(cardA);

    const cardB = await screen.findByTestId("ticket-card-101");
    expect(cardB).toHaveTextContent("TKT-101");
    expect(cardB).toHaveTextContent("Unassigned");
    expect(screen.getByTestId("ticket-stage-20")).toContainElement(cardB);
  });

  it("dragging a card to another stage calls moveTicketStage with {TicketId, StageId} and optimistically moves the card", async () => {
    let capturedBody = null;
    server.use(
      http.post("*/api/tickets/moveTicketStage", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          success: true,
          message: "Ticket stage updated",
          responseCode: 200,
          data: { Id: capturedBody.TicketId, ResponseCode: 200, ResponseMess: "Ticket stage updated" },
        });
      }),
    );

    renderBoard();
    await screen.findByTestId("ticket-card-100");
    expect(typeof dnd.onDragEnd).toBe("function");

    await dnd.onDragEnd({
      canceled: false,
      operation: {
        source: { type: "ticket", data: { ticketId: 100, stageId: 10 } },
        target: { data: { stageId: 20 } },
      },
    });

    await waitFor(() => {
      expect(capturedBody).toEqual({ TicketId: 100, StageId: 20, ResolutionId: null });
    });
    await waitFor(() => {
      expect(screen.getByTestId("ticket-stage-20")).toContainElement(
        screen.getByTestId("ticket-card-100"),
      );
    });
  });

  it("ignores a drop on the same stage (no mutation call)", async () => {
    let called = false;
    server.use(
      http.post("*/api/tickets/moveTicketStage", async () => {
        called = true;
        return HttpResponse.json({ success: true, message: "ok", responseCode: 200, data: {} });
      }),
    );
    renderBoard();
    await screen.findByTestId("ticket-card-100");

    await dnd.onDragEnd({
      canceled: false,
      operation: {
        source: { type: "ticket", data: { ticketId: 100, stageId: 10 } },
        target: { data: { stageId: 10 } },
      },
    });

    expect(called).toBe(false);
  });

  it("ignores a canceled drag", async () => {
    renderBoard();
    await screen.findByTestId("ticket-card-100");
    await expect(
      dnd.onDragEnd({ canceled: true, operation: {} }),
    ).resolves.toBeUndefined();
  });

  it("clicking a card opens the ticket detail modal", async () => {
    renderBoard();
    const card = await screen.findByTestId("ticket-card-100");

    expect(screen.queryByTestId("ticket-detail-modal")).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(card);
    expect(await screen.findByTestId("ticket-detail-modal")).toBeInTheDocument();
  });

  it("every card carries an explicit open button as the click affordance", async () => {
    renderBoard();
    await screen.findByTestId("ticket-card-100");
    expect(screen.getByTestId("ticket-open-100")).toBeInTheDocument();
    expect(screen.getByTestId("ticket-open-101")).toBeInTheDocument();
  });

  // Stage is the lifecycle's source of truth: first entry into a won stage
  // requires picking a resolution, so the drag parks in a modal.
  it("dragging into a won stage opens the resolution prompt instead of moving immediately", async () => {
    let called = false;
    server.use(
      http.post("*/api/tickets/moveTicketStage", async () => {
        called = true;
        return HttpResponse.json({ success: true, message: "ok", responseCode: 200, data: {} });
      }),
    );
    renderBoard();
    await screen.findByTestId("ticket-card-100");

    await dnd.onDragEnd({
      canceled: false,
      operation: {
        source: { type: "ticket", data: { ticketId: 100, stageId: 10 } },
        target: { data: { stageId: 30 } },
      },
    });

    expect(await screen.findByTestId("board-resolve-modal")).toBeInTheDocument();
    expect(called).toBe(false); // nothing sent until a resolution is picked
    // Card stays put until confirmed.
    expect(screen.getByTestId("ticket-stage-10")).toContainElement(
      screen.getByTestId("ticket-card-100"),
    );
  });

  it("confirming the resolution moves the ticket with the picked ResolutionId", async () => {
    let capturedBody = null;
    server.use(
      http.post("*/api/tickets/moveTicketStage", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          success: true, message: "ok", responseCode: 200,
          data: { Id: capturedBody.TicketId, ResponseCode: 200, ResponseMess: "ok" },
        });
      }),
    );
    renderBoard();
    await screen.findByTestId("ticket-card-100");

    await dnd.onDragEnd({
      canceled: false,
      operation: {
        source: { type: "ticket", data: { ticketId: 100, stageId: 10 } },
        target: { data: { stageId: 30 } },
      },
    });

    const user = userEvent.setup();
    const submit = await screen.findByTestId("board-resolve-submit");
    expect(submit).toBeDisabled();

    await user.click(screen.getByTestId("board-resolution-combobox-input"));
    await user.click(await screen.findByText("Fixed"));
    await user.click(submit);

    await waitFor(() => {
      expect(capturedBody).toEqual({ TicketId: 100, StageId: 30, ResolutionId: 5 });
    });
    await waitFor(() => {
      expect(screen.getByTestId("ticket-stage-30")).toContainElement(
        screen.getByTestId("ticket-card-100"),
      );
    });
  });

  it("cancelling the resolution prompt leaves the ticket where it was", async () => {
    let called = false;
    server.use(
      http.post("*/api/tickets/moveTicketStage", async () => {
        called = true;
        return HttpResponse.json({ success: true, message: "ok", responseCode: 200, data: {} });
      }),
    );
    renderBoard();
    await screen.findByTestId("ticket-card-100");

    await dnd.onDragEnd({
      canceled: false,
      operation: {
        source: { type: "ticket", data: { ticketId: 100, stageId: 10 } },
        target: { data: { stageId: 30 } },
      },
    });

    const user = userEvent.setup();
    await screen.findByTestId("board-resolve-modal");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(called).toBe(false);
    expect(screen.getByTestId("ticket-stage-10")).toContainElement(
      screen.getByTestId("ticket-card-100"),
    );
  });

  it("rolls back the optimistic move when the mutation fails", async () => {
    server.use(
      http.post("*/api/tickets/moveTicketStage", async () =>
        HttpResponse.json(
          { success: false, message: "Failed to move ticket stage", responseCode: 500 },
          { status: 500 },
        ),
      ),
    );
    renderBoard();
    await screen.findByTestId("ticket-card-100");

    await dnd.onDragEnd({
      canceled: false,
      operation: {
        source: { type: "ticket", data: { ticketId: 100, stageId: 10 } },
        target: { data: { stageId: 20 } },
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("ticket-stage-10")).toContainElement(
        screen.getByTestId("ticket-card-100"),
      );
    });
  });
});
