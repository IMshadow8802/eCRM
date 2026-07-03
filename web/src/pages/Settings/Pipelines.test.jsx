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
    http.post("*/api/config/fetchPipelines", async () =>
      HttpResponse.json({
        success: true,
        message: "ok",
        responseCode: 200,
        data: { pipelines, stages },
      }),
    ),
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
    ]);
  });

  it("lists pipelines for Entity='lead'", async () => {
    renderPage();
    expect(await screen.findByText("Sales Pipeline")).toBeInTheDocument();
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

  it("shows an empty state when there are no pipelines", async () => {
    seedPipelines([]);
    renderPage();
    expect(await screen.findByTestId("master-grid-empty")).toBeInTheDocument();
  });
});
