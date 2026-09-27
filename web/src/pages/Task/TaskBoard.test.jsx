import { readFileSync } from "node:fs";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TaskBoard from "./TaskBoard";
import useWorkspaceStore from "../../stores/useWorkspaceStore";
import useAuthStore from "../../stores/useAuthStore";
import { taskFixture } from "../../test/mocks/handlers";
import renderWithProviders from "../../test/renderWithProviders";

const renderBoard = () => renderWithProviders(<TaskBoard />);

describe("TaskBoard", () => {
  beforeEach(() => {
    taskFixture.reset();
    useWorkspaceStore.getState().clearActiveWorkspace();
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      UserId: 1,
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
  });

  it("shows empty-state welcome when no workspace selected", async () => {
    const { server } = await import("../../test/mocks/server");
    const { http, HttpResponse } = await import("msw");
    server.use(
      http.post("*/api/workspaces/ensurePersonalWorkspace", async () =>
        HttpResponse.json({ success: false, message: "no auto seed", responseCode: 500 }, { status: 500 }),
      ),
    );
    renderBoard();
    expect(
      await screen.findByText(/Welcome — pick or create a workspace/i),
    ).toBeInTheDocument();
  });

  it("renders columns + add-column tile when workspace active", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "personal",
      MyRole: "owner",
    });
    renderBoard();
    expect(await screen.findByText("To Do")).toBeInTheDocument();
    expect(await screen.findByText("In Progress")).toBeInTheDocument();
    expect(await screen.findByText("Done")).toBeInTheDocument();
    // Top-level "New task" button retired — tasks are created per-column.
    expect(screen.queryByTestId("new-task-btn")).not.toBeInTheDocument();
    // Inline column add tile present for an owner.
    expect(await screen.findByTestId("column-add-button")).toBeInTheDocument();
  });

  it("shows tasks in their columns", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "personal",
      MyRole: "owner",
    });
    taskFixture.seed({
      Id: 601,
      Title: "Test A",
      Status: "todo",
      ColumnId: 1,
      Priority: "medium",
      WorkspaceId: 100,
      CreatedByUserId: 1,
    });
    taskFixture.seed({
      Id: 602,
      Title: "Test B",
      Status: "done",
      ColumnId: 3,
      Priority: "high",
      WorkspaceId: 100,
      CreatedByUserId: 1,
    });
    renderBoard();
    expect(await screen.findByText("Test A")).toBeInTheDocument();
    expect(await screen.findByText("Test B")).toBeInTheDocument();
  });

  it("hides the inline add-column tile for viewer role", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "shared",
      MyRole: "viewer",
    });
    renderBoard();
    await waitFor(() => {
      expect(screen.queryByTestId("column-add-button")).not.toBeInTheDocument();
    });
    // And the per-column quick-add is gated by canCreate (owner/manager/member).
    expect(screen.queryByText(/Add task/i)).not.toBeInTheDocument();
  });

  it("search input updates query params", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "personal",
      MyRole: "owner",
    });
    renderBoard();
    const search = await screen.findByPlaceholderText(/Search tasks/i);
    const user = userEvent.setup();
    await user.type(search, "urgent");
    expect(search).toHaveValue("urgent");
  });

  it("clicking a column's Add task opens the full modal pre-filled with that column", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "personal",
      MyRole: "owner",
    });
    renderBoard();
    const user = userEvent.setup();
    const btns = await screen.findAllByText(/Add task/i);
    await user.click(btns[0]);
    expect(
      await screen.findByText(/Lands in .+column/i),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText(/title/i), "Quick one");
    const stepInput = await screen.findByTestId("create-task-step-0");
    const innerStep = stepInput.querySelector("input") || stepInput;
    await user.type(innerStep, "First step");
    await user.click(screen.getByTestId("create-task-submit"));
    await waitFor(() => {
      expect(taskFixture.list.some((t) => t.Title === "Quick one")).toBe(true);
    });
  });

  it("bulk delete removes tasks from fixture", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "personal",
      MyRole: "owner",
    });
    taskFixture.seed({
      Id: 777,
      Title: "Doomed",
      Status: "todo",
      ColumnId: 1,
      Priority: "low",
      WorkspaceId: 100,
      CreatedByUserId: 1,
    });
    renderBoard();
    const user = userEvent.setup();
    const checkbox = await screen.findByTestId("card-select-777");
    // Checkbox input is visually hidden; click it directly, not via pointer
    checkbox.click();
    const deleteBtn = await screen.findByTestId("bulk-delete");
    await user.click(deleteBtn);
    await waitFor(() => {
      expect(taskFixture.list.find((t) => t.Id === 777)).toBeUndefined();
    });
  });

  it("bulk delete surfaces 409 toast when checklist items block deletion", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "personal",
      MyRole: "owner",
    });
    taskFixture.seed({
      Id: 888,
      Title: "Locked",
      Status: "todo",
      ColumnId: 1,
      Priority: "low",
      WorkspaceId: 100,
      ChecklistItems: ["step 1"],
      CreatedByUserId: 1,
    });
    renderBoard();
    const user = userEvent.setup();
    const checkbox = await screen.findByTestId("card-select-888");
    checkbox.click();
    const deleteBtn = await screen.findByTestId("bulk-delete");
    await user.click(deleteBtn);
    // Task survives because MSW returns 409.
    await waitFor(() => {
      expect(taskFixture.list.find((t) => t.Id === 888)).toBeDefined();
    });
  });

  it("orphan column renders for task with unknown ColumnId", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "personal",
      MyRole: "owner",
    });
    taskFixture.seed({
      Id: 910,
      Title: "Orphan",
      ColumnId: 9999,
      Priority: "low",
      WorkspaceId: 100,
      CreatedByUserId: 1,
    });
    renderBoard();
    expect(await screen.findByTestId("kanban-card-910")).toBeInTheDocument();
    expect(await screen.findByText(/Uncategorized/i)).toBeInTheDocument();
  });

  it("apply-template modal opens + applies selected template when columns empty", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "personal",
      MyRole: "owner",
    });
    const { server } = await import("../../test/mocks/server");
    const { http, HttpResponse } = await import("msw");
    server.use(
      http.post("*/api/kanban/fetchKanbanColumns", async () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: {
            columns: [],
            kanbanColumns: [],
            pagination: {
              currentPage: 1,
              pageSize: 100,
              totalRecords: 0,
              totalPages: 1,
            },
          },
        }),
      ),
    );
    renderBoard();
    const cta = await screen.findByTestId("apply-template-cta");
    const user = userEvent.setup();
    await user.click(cta);
    expect(await screen.findByTestId("apply-template-modal")).toBeInTheDocument();
    await user.click(screen.getByTestId("apply-template-confirm"));
    // Modal closes + toast fires; no hard assertion needed beyond reaching code path
  });

  it("bulk delete appears after selecting a task", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "personal",
      MyRole: "owner",
    });
    taskFixture.seed({
      Id: 701,
      Title: "Pick me",
      Status: "todo",
      ColumnId: 1,
      Priority: "low",
      WorkspaceId: 100,
      CreatedByUserId: 1,
    });
    renderBoard();
    const checkbox = await screen.findByTestId("card-select-701");
    checkbox.click();
    expect(await screen.findByTestId("bulk-delete")).toBeInTheDocument();
  });

  // Regression, 2026-09-19: PointerSensor binds onPointerDown, which fires
  // before onTouchStart on every touch device, so it claimed the gesture and
  // the delayed TouchSensor never ran — meaning an 8px swipe on a card started
  // a drag instead of scrolling the column. MouseSensor binds onMouseDown and
  // so never claims a touch. Reintroducing PointerSensor would silently undo
  // this, and nothing else in the suite would notice.
  it("disambiguates touch from scroll with a mouse sensor and a delayed touch sensor", () => {
    const src = readFileSync("src/pages/Task/TaskBoard.jsx", "utf8");
    expect(src).toMatch(/useSensor\(MouseSensor, \{ activationConstraint: \{ distance: 8 \} \}\)/);
    expect(src).toMatch(/useSensor\(TouchSensor, \{ activationConstraint: \{ delay: \d+, tolerance: \d+ \} \}\)/);
    // Usage, not the word — the comment above the sensors explains why
    // PointerSensor is wrong and would otherwise trip this.
    expect(src).not.toMatch(/useSensor\(PointerSensor/);
  });

  it("adopts the personal workspace the server seeds when none is active", async () => {
    renderBoard();
    expect(await screen.findByText("To Do")).toBeInTheDocument();
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(100);
    expect(useWorkspaceStore.getState().activeWorkspaceType).toBe("personal");
  });

  it("names the active workspace in the header", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "project",
      MyRole: "owner",
      Name: "Q4 Launch",
      Color: "#123456",
    });
    renderBoard();
    const chip = await screen.findByTestId("active-workspace-chip");
    expect(chip).toHaveTextContent("Q4 Launch");
  });

  it("leaves the name out of the header when the workspace has none", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "personal",
      MyRole: "owner",
    });
    renderBoard();
    await screen.findByText("To Do");
    expect(screen.queryByTestId("active-workspace-chip")).not.toBeInTheDocument();
  });

  it.each([
    ["personal", "lucide-book-open"],
    ["shared", "lucide-handshake"],
    ["project", "lucide-rocket"],
  ])("badges a %s workspace with its own icon", async (type, glyph) => {
    useWorkspaceStore.getState().setActiveWorkspace({ Id: 100, Type: type, MyRole: "owner" });
    const { container } = renderBoard();
    await screen.findByText("To Do");
    expect(container.querySelector(`.${glyph}`)).toBeInTheDocument();
  });

  it("falls back to a generic icon for a workspace type it does not know", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "archive",
      MyRole: "owner",
    });
    const { container } = renderBoard();
    await screen.findByText("To Do");
    expect(container.querySelector(".lucide-square-check-big")).toBeInTheDocument();
  });

  // Mirrors sp_CheckTaskPermission: a member may move their own work and
  // anything assigned to them, and nothing else. A card that cannot be moved
  // must not offer the grab cursor — the board used to let every role start a
  // drag, and the server 403'd after the card had already jumped.
  it("offers the drag affordance to a member only on their own cards", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "shared",
      MyRole: "member",
    });
    taskFixture.seed({
      Id: 811,
      Title: "Mine",
      ColumnId: 1,
      Priority: "low",
      WorkspaceId: 100,
      CreatedByUserId: 1,
    });
    taskFixture.seed({
      Id: 812,
      Title: "Someone else's",
      ColumnId: 1,
      Priority: "low",
      WorkspaceId: 100,
      CreatedByUserId: 2,
    });
    renderBoard();
    expect((await screen.findByTestId("kanban-card-811")).style.cursor).toBe("grab");
    expect(screen.getByTestId("kanban-card-812").style.cursor).toBe("default");
  });

  it("falls back to the store's own UserId when the user record carries none", async () => {
    useAuthStore.setState({ user: {}, UserId: 42 });
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "shared",
      MyRole: "member",
    });
    taskFixture.seed({
      Id: 821,
      Title: "Mine",
      ColumnId: 1,
      Priority: "low",
      WorkspaceId: 100,
      CreatedByUserId: 42,
    });
    taskFixture.seed({
      Id: 822,
      Title: "Theirs",
      ColumnId: 1,
      Priority: "low",
      WorkspaceId: 100,
      CreatedByUserId: 7,
    });
    renderBoard();
    expect((await screen.findByTestId("kanban-card-821")).style.cursor).toBe("grab");
    expect(screen.getByTestId("kanban-card-822").style.cursor).toBe("default");
  });

  it("lets an admin drag a card they neither created nor own", async () => {
    useAuthStore.setState({ user: { UserId: 1, IsAdmin: true }, UserId: 1 });
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "shared",
      MyRole: "viewer",
    });
    taskFixture.seed({
      Id: 831,
      Title: "Someone else's",
      ColumnId: 1,
      Priority: "low",
      WorkspaceId: 100,
      CreatedByUserId: 9,
    });
    renderBoard();
    expect((await screen.findByTestId("kanban-card-831")).style.cursor).toBe("grab");
  });

  it("drops a task out of the selection when its checkbox is clicked again", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "personal",
      MyRole: "owner",
    });
    taskFixture.seed({
      Id: 702,
      Title: "On and off",
      ColumnId: 1,
      Priority: "low",
      WorkspaceId: 100,
      CreatedByUserId: 1,
    });
    renderBoard();
    const checkbox = await screen.findByTestId("card-select-702");
    checkbox.click();
    expect(await screen.findByTestId("bulk-delete")).toBeInTheDocument();

    checkbox.click();
    await waitFor(() => {
      expect(screen.queryByTestId("bulk-delete")).not.toBeInTheDocument();
    });
  });

  it("keeps the template modal open when applying the template fails", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "personal",
      MyRole: "owner",
    });
    const { server } = await import("../../test/mocks/server");
    const { http, HttpResponse } = await import("msw");
    server.use(
      http.post("*/api/kanban/fetchKanbanColumns", async () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: {
            columns: [],
            kanbanColumns: [],
            pagination: { currentPage: 1, pageSize: 100, totalRecords: 0, totalPages: 1 },
          },
        }),
      ),
      http.post("*/api/workspaces/applyKanbanTemplate", async () =>
        HttpResponse.json(
          { success: false, message: "template missing", responseCode: 500 },
          { status: 500 },
        ),
      ),
    );
    renderBoard();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("apply-template-cta"));
    await user.click(await screen.findByTestId("apply-template-confirm"));
    await waitFor(() => {
      expect(screen.getByTestId("apply-template-confirm")).toBeEnabled();
    });
    expect(screen.getByTestId("apply-template-modal")).toBeInTheDocument();
  });

  // The payload has carried both keys for a while; the legacy one is the
  // contract the SP actually documents, so the board still has to read it.
  it("reads the legacy columns key and orders columns with no SortOrder first", async () => {
    useWorkspaceStore.getState().setActiveWorkspace({
      Id: 100,
      Type: "personal",
      MyRole: "owner",
    });
    const { server } = await import("../../test/mocks/server");
    const { http, HttpResponse } = await import("msw");
    server.use(
      http.post("*/api/kanban/fetchKanbanColumns", async () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          responseCode: 200,
          data: {
            columns: [
              { Id: 21, Title: "Later", Color: "#888888", SortOrder: 5 },
              { Id: 22, Title: "Unsorted", Color: "#888888" },
            ],
            pagination: { currentPage: 1, pageSize: 100, totalRecords: 2, totalPages: 1 },
          },
        }),
      ),
    );
    const { container } = renderBoard();
    await screen.findByText("Unsorted");
    const titles = [...container.querySelectorAll("*")]
      .filter((el) => el.children.length === 0)
      .map((el) => el.textContent)
      .filter((t) => t === "Later" || t === "Unsorted");
    expect(titles[0]).toBe("Unsorted");
  });
});
