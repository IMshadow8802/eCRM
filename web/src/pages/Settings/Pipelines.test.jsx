import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import Pipelines from "./Pipelines";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const renderPage = () => renderWithProviders(<Pipelines />);

let pipelines;
let stages;
let lastFetchBody;
let lastSaveStageBody;
let lastSavePipelineBody;

// fetchPipelines returns two arrays: `pipelines` and a flat `stages` list
// (each stage carries its PipelineId), matching sp_FetchPipelines' 2 result
// sets. The initial seed embeds Stages on each pipeline for convenience; we
// flatten it into the shared `stages` list here.
const seedPipelines = (initial = []) => {
  pipelines = initial.map(({ Stages, ...p }) => ({ ...p }));
  stages = initial.flatMap((p) =>
    (p.Stages || []).map((s) => ({ ...s, PipelineId: p.Id })),
  );
  server.use(
    // The page fetches per-Entity — the handler filters like sp_FetchPipelines.
    http.post("*/api/config/fetchPipelines", async ({ request }) => {
      const body = await request.json();
      lastFetchBody = body;
      return HttpResponse.json({
        success: true,
        message: "ok",
        responseCode: 200,
        data: { pipelines: pipelines.filter((p) => p.Entity === body.Entity), stages },
      });
    }),
    http.post("*/api/config/savePipeline", async ({ request }) => {
      const body = await request.json();
      lastSavePipelineBody = body;
      if (!body.Name) {
        return HttpResponse.json({ success: false, message: "Name required", responseCode: 400 });
      }
      const id = pipelines.length ? Math.max(...pipelines.map((p) => p.Id)) + 1 : 1;
      pipelines.push({ Id: id, Entity: body.Entity, Name: body.Name, IsDefault: false });
      return HttpResponse.json({ success: true, message: "Saved", responseCode: 200, data: { Id: id } });
    }),
    http.post("*/api/config/saveStage", async ({ request }) => {
      const body = await request.json();
      lastSaveStageBody = body;
      if (!body.Name) {
        return HttpResponse.json({ success: false, message: "Name required", responseCode: 400 });
      }
      if (!pipelines.some((p) => p.Id === body.PipelineId)) {
        return HttpResponse.json({ success: false, message: "Pipeline not found", responseCode: 404 });
      }
      if (body.Id) {
        const idx = stages.findIndex((s) => s.Id === body.Id);
        if (idx !== -1) stages[idx] = { ...stages[idx], ...body };
      } else {
        const id = stages.length ? Math.max(...stages.map((s) => s.Id)) + 1 : 1;
        stages.push({ ...body, Id: id });
      }
      return HttpResponse.json({ success: true, message: "Saved", responseCode: 200, data: { Id: body.Id || 1 } });
    }),
    http.post("*/api/config/deleteStage", async ({ request }) => {
      const body = await request.json();
      stages = stages.filter((s) => s.Id !== body.Id);
      return HttpResponse.json({ success: true, message: "Deleted", responseCode: 200 });
    }),
  );
};

describe("Pipelines page", () => {
  beforeEach(() => {
    lastFetchBody = undefined;
    lastSaveStageBody = undefined;
    lastSavePipelineBody = undefined;
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
    seedPipelines([
      {
        Id: 9,
        Entity: "lead",
        Name: "Sales Pipeline",
        IsDefault: true,
        Stages: [
          { Id: 41, Name: "New", SortOrder: 1, StageType: "open", Color: "#3B82F6" },
          { Id: 42, Name: "Qualified", SortOrder: 2, StageType: "open", Color: "#F59E0B" },
        ],
      },
      {
        Id: 10,
        Entity: "ticket",
        Name: "Support",
        IsDefault: true,
        Stages: [{ Id: 51, Name: "Open", SortOrder: 1, StageType: "open", Color: "#3B82F6" }],
      },
    ]);
  });

  it("lists pipelines for Entity='lead' by default", async () => {
    renderPage();
    expect(await screen.findByText("Sales Pipeline")).toBeInTheDocument();
    expect(screen.queryByText("Support")).not.toBeInTheDocument();
    await waitFor(() => expect(lastFetchBody).toEqual({ Entity: "lead" }));
  });

  it("switches to the Tickets tab and fetches with Entity='ticket'", async () => {
    renderPage();
    await screen.findByText("Sales Pipeline");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("pipeline-entity-tabs-ticket"));

    expect(await screen.findByText("Support")).toBeInTheDocument();
    expect(screen.queryByText("Sales Pipeline")).not.toBeInTheDocument();
    await waitFor(() => expect(lastFetchBody).toEqual({ Entity: "ticket" }));
  });

  it("creates a pipeline under the active entity (Entity='ticket')", async () => {
    renderPage();
    await screen.findByText("Sales Pipeline");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("pipeline-entity-tabs-ticket"));
    await screen.findByText("Support");

    await user.click(screen.getByTestId("master-grid-create"));
    await user.type(await screen.findByLabelText(/Pipeline Name/), "Escalations");
    await user.click(screen.getByRole("button", { name: /create pipeline/i }));

    await waitFor(() => {
      expect(lastSavePipelineBody).toMatchObject({ Id: 0, Entity: "ticket", Name: "Escalations" });
    });
    expect(await screen.findByText("Escalations")).toBeInTheDocument();
  });

  it("drills into a pipeline and lists its stages", async () => {
    renderPage();
    await screen.findByText("Sales Pipeline");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-edit-9"));

    expect(await screen.findByText("New")).toBeInTheDocument();
    expect(screen.getByText("Qualified")).toBeInTheDocument();
    expect(screen.getByText(/Stages — Sales Pipeline/)).toBeInTheDocument();
  });

  it("edits a stage's SortOrder/StageType/Color and calls saveStage", async () => {
    renderPage();
    await screen.findByText("Sales Pipeline");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-edit-9"));
    await screen.findByText("New");

    await user.click(screen.getByTestId("master-grid-edit-41"));

    const nameInput = await screen.findByLabelText(/Stage Name/);
    expect(nameInput).toHaveValue("New");

    // Change stage type to "won"
    const stageTypeCombo = screen.getAllByRole("combobox")[0];
    await user.click(stageTypeCombo);
    await user.click(await screen.findByText("Won"));

    const colorInput = screen.getByLabelText("Color");
    await user.clear(colorInput);
    await user.type(colorInput, "#10B981");

    await user.click(screen.getByRole("button", { name: /update stage/i }));

    await waitFor(() => {
      expect(lastSaveStageBody).toMatchObject({
        Id: 41,
        PipelineId: 9,
        Name: "New",
        StageType: "won",
        Color: "#10B981",
      });
    });
  });

  it("creates a new stage under the selected pipeline via saveStage", async () => {
    renderPage();
    await screen.findByText("Sales Pipeline");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-edit-9"));
    await screen.findByText("New");

    await user.click(screen.getByTestId("master-grid-create"));
    await user.type(await screen.findByLabelText(/Stage Name/), "Won");
    await user.click(screen.getByRole("button", { name: /create stage/i }));

    await waitFor(() => {
      expect(lastSaveStageBody).toMatchObject({ Id: 0, PipelineId: 9, Name: "Won", StageType: "open" });
    });
    expect(await screen.findByText("Won")).toBeInTheDocument();
  });

  it("deletes a stage after confirmation", async () => {
    renderPage();
    await screen.findByText("Sales Pipeline");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-edit-9"));
    await screen.findByText("New");

    await user.click(screen.getByTestId("master-grid-delete-41"));
    const dialog = await screen.findByTestId("confirmation-dialog");
    await user.click(within(dialog).getByRole("button", { name: /delete stage/i }));

    await waitFor(() => expect(screen.queryByText("New")).not.toBeInTheDocument());
  });

  it("navigates back to the pipeline list", async () => {
    renderPage();
    await screen.findByText("Sales Pipeline");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-edit-9"));
    await screen.findByText("New");

    await user.click(screen.getByTestId("pipelines-back-button"));
    expect(await screen.findByText("Sales Pipeline")).toBeInTheDocument();
    expect(screen.queryByText("New")).not.toBeInTheDocument();
  });

  it("creates a new pipeline via savePipeline", async () => {
    renderPage();
    await screen.findByText("Sales Pipeline");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-create"));
    await user.type(await screen.findByLabelText(/Pipeline Name/), "Support Pipeline");
    await user.click(screen.getByRole("button", { name: /create pipeline/i }));

    await waitFor(() => {
      expect(lastSavePipelineBody).toMatchObject({ Id: 0, Entity: "lead", Name: "Support Pipeline" });
    });
    expect(await screen.findByText("Support Pipeline")).toBeInTheDocument();
  });

  it("requires a pipeline name before saving", async () => {
    renderPage();
    await screen.findByText("Sales Pipeline");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-create"));
    await user.click(screen.getByRole("button", { name: /create pipeline/i }));

    expect(await screen.findByText("Pipeline name is required")).toBeInTheDocument();
    expect(lastSavePipelineBody).toBeUndefined();
  });

  it("surfaces the API error when savePipeline fails", async () => {
    server.use(
      http.post("*/api/config/savePipeline", () =>
        HttpResponse.json({ success: false, message: "Duplicate pipeline", responseCode: 400 }),
      ),
    );
    renderPage();
    await screen.findByText("Sales Pipeline");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-create"));
    await user.type(await screen.findByLabelText(/Pipeline Name/), "Sales Pipeline");
    await user.click(screen.getByRole("button", { name: /create pipeline/i }));

    expect(await screen.findByText("Duplicate pipeline")).toBeInTheDocument();
  });

  it("surfaces the API error when saveStage fails", async () => {
    server.use(
      http.post("*/api/config/saveStage", () =>
        HttpResponse.json({ success: false, message: "Duplicate stage", responseCode: 400 }),
      ),
    );
    renderPage();
    await screen.findByText("Sales Pipeline");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-edit-9"));
    await screen.findByText("New");

    await user.click(screen.getByTestId("master-grid-create"));
    await user.type(await screen.findByLabelText(/Stage Name/), "Won");
    await user.click(screen.getByRole("button", { name: /create stage/i }));

    expect(await screen.findByText("Duplicate stage")).toBeInTheDocument();
  });

  it("surfaces the API error when deleteStage fails", async () => {
    server.use(
      http.post("*/api/config/deleteStage", () =>
        HttpResponse.json({ success: false, message: "Stage has leads", responseCode: 400 }),
      ),
    );
    renderPage();
    await screen.findByText("Sales Pipeline");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-edit-9"));
    await screen.findByText("New");

    await user.click(screen.getByTestId("master-grid-delete-41"));
    const dialog = await screen.findByTestId("confirmation-dialog");
    await user.click(within(dialog).getByRole("button", { name: /delete stage/i }));

    expect(await screen.findByText("Stage has leads")).toBeInTheDocument();
  });

  it("requires a stage name before saving", async () => {
    renderPage();
    await screen.findByText("Sales Pipeline");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-edit-9"));
    await screen.findByText("New");

    await user.click(screen.getByTestId("master-grid-create"));
    await user.click(screen.getByRole("button", { name: /create stage/i }));

    expect(await screen.findByText("Stage name is required")).toBeInTheDocument();
    expect(lastSaveStageBody).toBeUndefined();
  });

  it("falls back to a generic error when the savePipeline request errors", async () => {
    server.use(http.post("*/api/config/savePipeline", () => HttpResponse.error()));
    renderPage();
    await screen.findByText("Sales Pipeline");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-create"));
    await user.type(await screen.findByLabelText(/Pipeline Name/), "Escalations");
    await user.click(screen.getByRole("button", { name: /create pipeline/i }));

    expect(await screen.findByText("Failed to create pipeline")).toBeInTheDocument();
  });

  it("falls back to a generic error when the deleteStage request errors", async () => {
    server.use(http.post("*/api/config/deleteStage", () => HttpResponse.error()));
    renderPage();
    await screen.findByText("Sales Pipeline");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-edit-9"));
    await screen.findByText("New");

    await user.click(screen.getByTestId("master-grid-delete-41"));
    const dialog = await screen.findByTestId("confirmation-dialog");
    await user.click(within(dialog).getByRole("button", { name: /delete stage/i }));

    expect(await screen.findByText("Failed to delete stage!")).toBeInTheDocument();
  });

  it("shows an empty state when there are no pipelines", async () => {
    seedPipelines([]);
    renderPage();
    expect(await screen.findByTestId("master-grid-empty")).toBeInTheDocument();
  });
});
