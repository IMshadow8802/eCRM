import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import TaskBoard from "./TaskBoard";
import useWorkspaceStore from "../../stores/useWorkspaceStore";
import useAuthStore from "../../stores/useAuthStore";
import { taskFixture } from "../../test/mocks/handlers";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

// jsdom has no layout, so a real pointer drag never resolves a drop target.
// Keep the real DndContext and capture its props so the test can deliver the
// drop dnd-kit would have delivered.
const dnd = vi.hoisted(() => ({ props: null }));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const mod = await importOriginal();
  const Capture = (props) => {
    dnd.props = props;
    return <mod.DndContext {...props} />;
  };
  return { ...mod, DndContext: Capture };
});

const drop = (taskId, columnId) =>
  act(() =>
    dnd.props.onDragEnd({
      active: { data: { current: { taskId } } },
      over: { data: { current: { columnId } } },
    }),
  );

describe("TaskBoard drag → moveTaskColumn", () => {
  beforeEach(() => {
    taskFixture.reset();
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      UserId: 1,
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
    useWorkspaceStore.getState().setActiveWorkspace({ Id: 100, Type: "personal", MyRole: "owner" });
    taskFixture.seed({
      Id: 701,
      Title: "Open card",
      ColumnId: 1,
      Priority: "medium",
      WorkspaceId: 100,
      CreatedByUserId: 1,
      IsCompleted: false,
    });
  });

  it("moves the card when the server accepts the drop", async () => {
    renderWithProviders(<TaskBoard />);
    await screen.findByText("Open card");
    await drop(701, 2);
    await waitFor(() =>
      expect(within(screen.getByTestId("kanban-column-2")).getByText("Open card")).toBeInTheDocument(),
    );
  });

  it("REGRESSION: a refused move (409 board = completion) shows the reason and puts the card back", async () => {
    server.use(
      http.post("*/api/tasks/moveTaskColumn", () =>
        HttpResponse.json(
          {
            success: false,
            message: "Tick the remaining steps to finish this task",
            responseCode: 409,
          },
          { status: 409 },
        ),
      ),
    );
    renderWithProviders(<TaskBoard />);
    await screen.findByText("Open card");
    await drop(701, 3);
    expect(
      await screen.findByText("Tick the remaining steps to finish this task"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(within(screen.getByTestId("kanban-column-1")).getByText("Open card")).toBeInTheDocument(),
    );
    expect(within(screen.getByTestId("kanban-column-3")).queryByText("Open card")).toBeNull();
  });

  it("ignores a drop on the card's own column or outside any column", async () => {
    let calls = 0;
    server.use(
      http.post("*/api/tasks/moveTaskColumn", () => {
        calls += 1;
        return HttpResponse.json({ success: true, message: "ok", responseCode: 200 });
      }),
    );
    renderWithProviders(<TaskBoard />);
    await screen.findByText("Open card");
    await drop(701, 1);
    await act(() => dnd.props.onDragEnd({ active: { data: { current: { taskId: 701 } } }, over: null }));
    expect(calls).toBe(0);
  });
});
