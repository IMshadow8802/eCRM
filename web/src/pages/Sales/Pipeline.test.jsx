import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, configure } from "@testing-library/react";
import { http, HttpResponse } from "msw";

// Cold-start module transform makes the first render in this file slow;
// RTL's default 1000ms findBy window can elapse before React Query settles.
configure({ asyncUtilTimeout: 5000 });

import Pipeline from "./Pipeline";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

// dnd-kit's real drag lifecycle needs real pointer/keyboard sensors that
// jsdom can't drive (no test in this codebase simulates a real drag — see
// TaskBoard.test.jsx). Instead we stub the library: DragDropProvider just
// renders children and stashes the onDragEnd callback so a test can invoke
// it directly with a hand-built event, exactly the shape @dnd-kit/react
// hands to onDragEnd for a real drag. useDroppable/useSortable become
// no-op ref hooks since there's no real drag context to plug into.
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
  Entity: "lead",
  Name: "Sales Pipeline",
  IsDefault: true,
  IsActive: true,
};
const STAGES = [
  { Id: 10, CompId: 5, PipelineId: 1, Name: "New", SortOrder: 1, StageType: "open", Color: "#3B82F6", IsActive: true },
  { Id: 20, CompId: 5, PipelineId: 1, Name: "Qualified", SortOrder: 2, StageType: "open", Color: "#8B5CF6", IsActive: true },
];
const LEADS = [
  { Id: 100, Name: "Acme Corp", StageId: 10, EstValue: 15000, NextFollowupDate: "2026-07-10", OwnerId: 3 },
  { Id: 101, Name: "Globex", StageId: 20, EstValue: 5000, NextFollowupDate: null, OwnerId: null },
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

function mockLeads(leads = LEADS) {
  server.use(
    http.post("*/api/leads/fetchLeads", async () =>
      HttpResponse.json({
        success: true,
        message: "Leads fetched successfully",
        responseCode: 200,
        data: {
          leads,
          pagination: { currentPage: 1, pageSize: 200, totalRecords: leads.length, totalPages: 1 },
        },
      }),
    ),
  );
}

const renderBoard = () => renderWithProviders(<Pipeline />);

describe("Pipeline", () => {
  beforeEach(() => {
    dnd.onDragEnd = null;
    mockPipelines();
    mockLeads();
  });

  it("renders stage columns from the default pipeline", async () => {
    renderBoard();
    expect(await screen.findByTestId("pipeline-stage-10")).toBeInTheDocument();
    expect(await screen.findByText("New")).toBeInTheDocument();
    expect(await screen.findByText("Qualified")).toBeInTheDocument();
  });

  it("falls back to the first pipeline when none is marked default", async () => {
    mockPipelines([{ ...PIPELINE, IsDefault: false }], STAGES);
    renderBoard();
    expect(await screen.findByText("New")).toBeInTheDocument();
  });

  it("shows an empty state when no pipeline/stages are configured", async () => {
    mockPipelines([], []);
    renderBoard();
    expect(await screen.findByText(/No pipeline configured/i)).toBeInTheDocument();
  });

  it("renders lead cards grouped under the right stage with Name, EstValue, follow-up chip, and owner", async () => {
    renderBoard();
    const cardA = await screen.findByTestId("pipeline-card-100");
    expect(cardA).toHaveTextContent("Acme Corp");
    expect(cardA).toHaveTextContent("15,000");
    expect(cardA).toHaveTextContent("10-07-2026");
    expect(cardA).toHaveTextContent("Owner #3");
    // Lands in its stage column, not the other one.
    expect(screen.getByTestId("pipeline-stage-10")).toContainElement(cardA);

    const cardB = await screen.findByTestId("pipeline-card-101");
    expect(cardB).toHaveTextContent("Globex");
    expect(cardB).toHaveTextContent("Unassigned");
    expect(screen.getByTestId("pipeline-stage-20")).toContainElement(cardB);
  });

  it("dragging a card to another stage calls moveLeadStage with {LeadId, StageId} and optimistically moves the card", async () => {
    let capturedBody = null;
    server.use(
      http.post("*/api/leads/moveLeadStage", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          success: true,
          message: "Lead stage updated",
          responseCode: 200,
          data: { Id: capturedBody.LeadId, ResponseCode: 200, ResponseMess: "Lead stage updated" },
        });
      }),
    );

    renderBoard();
    await screen.findByTestId("pipeline-card-100");
    expect(typeof dnd.onDragEnd).toBe("function");

    await dnd.onDragEnd({
      canceled: false,
      operation: {
        source: { type: "lead", data: { leadId: 100, stageId: 10 } },
        target: { data: { stageId: 20 } },
      },
    });

    await waitFor(() => {
      expect(capturedBody).toEqual({ LeadId: 100, StageId: 20 });
    });
    // Optimistic cache update moved the card to the target column immediately.
    await waitFor(() => {
      expect(screen.getByTestId("pipeline-stage-20")).toContainElement(
        screen.getByTestId("pipeline-card-100"),
      );
    });
  });

  it("ignores a drop on the same stage (no mutation call)", async () => {
    let called = false;
    server.use(
      http.post("*/api/leads/moveLeadStage", async () => {
        called = true;
        return HttpResponse.json({ success: true, message: "ok", responseCode: 200, data: {} });
      }),
    );
    renderBoard();
    await screen.findByTestId("pipeline-card-100");

    await dnd.onDragEnd({
      canceled: false,
      operation: {
        source: { type: "lead", data: { leadId: 100, stageId: 10 } },
        target: { data: { stageId: 10 } },
      },
    });

    expect(called).toBe(false);
  });

  it("ignores a canceled drag", async () => {
    renderBoard();
    await screen.findByTestId("pipeline-card-100");
    await expect(
      dnd.onDragEnd({ canceled: true, operation: {} }),
    ).resolves.toBeUndefined();
  });

  it("rolls back the optimistic move when the mutation fails", async () => {
    server.use(
      http.post("*/api/leads/moveLeadStage", async () =>
        HttpResponse.json(
          { success: false, message: "Failed to move lead stage", responseCode: 500 },
          { status: 500 },
        ),
      ),
    );
    renderBoard();
    await screen.findByTestId("pipeline-card-100");

    await dnd.onDragEnd({
      canceled: false,
      operation: {
        source: { type: "lead", data: { leadId: 100, stageId: 10 } },
        target: { data: { stageId: 20 } },
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("pipeline-stage-10")).toContainElement(
        screen.getByTestId("pipeline-card-100"),
      );
    });
  });
});
