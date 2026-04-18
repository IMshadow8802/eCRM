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
          { Id: 1, Title: "T1", Priority: "medium", Status: "in-progress" },
          { Id: 2, Title: "T2", Priority: "low", Status: "in-progress" },
        ]}
      />,
    );
    expect(screen.getByText("T1")).toBeInTheDocument();
    expect(screen.getByText("T2")).toBeInTheDocument();
  });

  it("quick-add button opens input + submits on enter", async () => {
    const onQuickAdd = vi.fn();
    wrap(
      <KanbanColumn
        column={baseColumn}
        tasks={[]}
        onQuickAddTask={onQuickAdd}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("quick-add-btn-10"));
    const input = await screen.findByPlaceholderText(/Task title/i);
    await user.type(input, "New task{Enter}");
    expect(onQuickAdd).toHaveBeenCalledWith(
      expect.objectContaining({ Title: "New task", Status: "in-progress" }),
    );
  });

  it("shows 'Column full' when at capacity", () => {
    wrap(
      <KanbanColumn
        column={{ ...baseColumn, MaxTasks: 2 }}
        tasks={[
          { Id: 1, Title: "T1", Priority: "medium", Status: "in-progress" },
          { Id: 2, Title: "T2", Priority: "low", Status: "in-progress" },
        ]}
      />,
    );
    expect(screen.getByText(/Column full/i)).toBeInTheDocument();
  });

  it("hides quick-add when canCreate=false", () => {
    wrap(
      <KanbanColumn column={baseColumn} tasks={[]} canCreate={false} />,
    );
    expect(screen.queryByTestId("quick-add-btn-10")).not.toBeInTheDocument();
  });

  it("quick-add submit skipped when input empty", async () => {
    const onQuickAdd = vi.fn();
    wrap(
      <KanbanColumn column={baseColumn} tasks={[]} onQuickAddTask={onQuickAdd} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("quick-add-btn-10"));
    const input = await screen.findByPlaceholderText(/Task title/i);
    await user.type(input, "{Enter}");
    expect(onQuickAdd).not.toHaveBeenCalled();
  });

  it("Escape clears the quick-add input", async () => {
    wrap(<KanbanColumn column={baseColumn} tasks={[]} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("quick-add-btn-10"));
    const input = await screen.findByPlaceholderText(/Task title/i);
    await user.type(input, "Draft{Escape}");
    expect(screen.queryByPlaceholderText(/Task title/i)).not.toBeInTheDocument();
  });
});
