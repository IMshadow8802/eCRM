import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import KanbanCard from "./KanbanCard";
import renderWithProviders from "../../test/renderWithProviders";

function wrap(ui) {
  return renderWithProviders(
    <DndContext>
      <SortableContext items={["task-1"]}>{ui}</SortableContext>
    </DndContext>,
    { router: false },
  );
}

describe("KanbanCard", () => {
  it("renders title, priority, assignee, due date", () => {
    wrap(
      <KanbanCard
        task={{
          Id: 1,
          Title: "Do X",
          Priority: "high",
          AssigneeName: "Alice",
          DueDate: "2099-01-01",
          Status: "todo",
        }}
      />,
    );
    expect(screen.getByText("Do X")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("shows Blocked chip when IsBlocked=true", () => {
    wrap(
      <KanbanCard
        task={{ Id: 2, Title: "X", IsBlocked: true, Priority: "low", Status: "todo" }}
      />,
    );
    expect(screen.getByTestId("card-blocked-2")).toBeInTheDocument();
  });

  it("fires onOpen when card clicked", () => {
    const onOpen = vi.fn();
    wrap(
      <KanbanCard
        task={{ Id: 3, Title: "Y", Priority: "medium", Status: "todo" }}
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByTestId("kanban-card-3"));
    expect(onOpen).toHaveBeenCalled();
  });

  it("toggles selection without triggering onOpen", () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    wrap(
      <KanbanCard
        task={{ Id: 4, Title: "Z", Priority: "medium", Status: "todo" }}
        onOpen={onOpen}
        onToggleSelect={onToggle}
      />,
    );
    fireEvent.click(screen.getByTestId("card-select-4"));
    expect(onToggle).toHaveBeenCalledWith(4);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("renders when Status is done (completed indicator path)", () => {
    wrap(
      <KanbanCard
        task={{ Id: 9, Title: "Done task", Priority: "low", Status: "done" }}
      />,
    );
    expect(screen.getByText("Done task")).toBeInTheDocument();
  });

  it("renders when read but not done (read indicator path)", () => {
    wrap(
      <KanbanCard
        task={{
          Id: 10,
          Title: "Read",
          Priority: "low",
          Status: "todo",
          HasBeenRead: true,
        }}
      />,
    );
    expect(screen.getByText("Read")).toBeInTheDocument();
  });

  it("renders when delivered only (grey tick path)", () => {
    wrap(
      <KanbanCard
        task={{
          Id: 11,
          Title: "Delivered",
          Priority: "low",
          Status: "todo",
          HasBeenDelivered: true,
        }}
      />,
    );
    expect(screen.getByText("Delivered")).toBeInTheDocument();
  });

  it("renders due date chip with error color when overdue", () => {
    wrap(
      <KanbanCard
        task={{
          Id: 5,
          Title: "Late",
          Priority: "medium",
          Status: "todo",
          DueDate: "2000-01-01",
        }}
      />,
    );
    expect(screen.getByText("Late")).toBeInTheDocument();
  });
});
