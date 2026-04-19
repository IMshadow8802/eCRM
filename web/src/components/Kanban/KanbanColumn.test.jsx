import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DndContext } from "@dnd-kit/core";
import KanbanColumn from "./KanbanColumn";
import renderWithProviders from "../../test/renderWithProviders";

function wrap(ui) {
  return renderWithProviders(<DndContext>{ui}</DndContext>, { router: false });
}

const baseColumn = {
  Id: 10,
  Title: "In Progress",
  Color: "#3B82F6",
  MaxTasks: null,
  SortOrder: 2,
  IsDone: false,
};

describe("KanbanColumn", () => {
  it("renders title + task count", () => {
    wrap(<KanbanColumn column={baseColumn} tasks={[]} />);
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders tasks", () => {
    wrap(
      <KanbanColumn
        column={baseColumn}
        tasks={[
          { Id: 1, Title: "T1", Priority: "medium" },
          { Id: 2, Title: "T2", Priority: "low" },
        ]}
      />,
    );
    expect(screen.getByText("T1")).toBeInTheDocument();
    expect(screen.getByText("T2")).toBeInTheDocument();
  });

  it("Add task button calls onRequestAddTask with the column", async () => {
    const onRequest = vi.fn();
    wrap(
      <KanbanColumn
        column={baseColumn}
        tasks={[]}
        onRequestAddTask={onRequest}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("quick-add-btn-10"));
    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ Id: 10, Title: "In Progress" }),
    );
  });

  it("shows 'Column full' when at capacity", () => {
    wrap(
      <KanbanColumn
        column={{ ...baseColumn, MaxTasks: 2 }}
        tasks={[
          { Id: 1, Title: "T1", Priority: "medium" },
          { Id: 2, Title: "T2", Priority: "low" },
        ]}
      />,
    );
    expect(screen.getByText(/Column full/i)).toBeInTheDocument();
  });

  it("hides the add-task button when canCreate=false", () => {
    wrap(
      <KanbanColumn column={baseColumn} tasks={[]} canCreate={false} />,
    );
    expect(screen.queryByTestId("quick-add-btn-10")).not.toBeInTheDocument();
  });

  it("disables add-task at capacity (no onRequestAddTask fired)", async () => {
    const onRequest = vi.fn();
    wrap(
      <KanbanColumn
        column={{ ...baseColumn, MaxTasks: 1 }}
        tasks={[{ Id: 1, Title: "T1", Priority: "medium" }]}
        onRequestAddTask={onRequest}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("quick-add-btn-10"));
    expect(onRequest).not.toHaveBeenCalled();
  });

  it("menu shows Rename and Delete only (IsDone toggle retired)", async () => {
    wrap(
      <KanbanColumn column={baseColumn} tasks={[]} canManage />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("column-menu-10"));
    expect(await screen.findByText(/Rename column/i)).toBeInTheDocument();
    expect(screen.getByText(/Delete column/i)).toBeInTheDocument();
    expect(screen.queryByText(/Mark as done column/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Unmark as done column/i)).not.toBeInTheDocument();
  });

  it("clicking title enters rename mode when canManage", async () => {
    wrap(
      <KanbanColumn column={baseColumn} tasks={[]} canManage />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("column-title-10"));
    expect(await screen.findByTestId("column-rename-input-10")).toBeInTheDocument();
  });

  it("delete menu opens the confirmation modal", async () => {
    wrap(
      <KanbanColumn
        column={baseColumn}
        tasks={[]}
        canManage
        siblingColumns={[{ Id: 11, Title: "Done" }]}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("column-menu-10"));
    await user.click(await screen.findByText(/Delete column/i));
    expect(
      await screen.findByTestId("column-delete-modal-10"),
    ).toBeInTheDocument();
  });
});
