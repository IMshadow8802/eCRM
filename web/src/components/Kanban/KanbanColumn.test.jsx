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
});
