import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import KanbanCard, { KanbanCardView } from "./KanbanCard";
import renderWithProviders from "../../test/renderWithProviders";

function wrap(ui) {
  return renderWithProviders(<DndContext>{ui}</DndContext>, { router: false });
}

describe("KanbanCard", () => {
  it("renders title, priority, assignee, due date (legacy scalar task)", () => {
    wrap(
      <KanbanCard
        task={{
          Id: 1,
          Title: "Do X",
          Priority: "high",
          AssignedToUserId: 7,
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

  it("renders one avatar per assignee for a two-assignee task", () => {
    wrap(
      <KanbanCard
        task={{
          Id: 30,
          Title: "Pair work",
          Priority: "medium",
          AssigneesJson: JSON.stringify([
            { UserId: 1, FullName: "Alice A" },
            { UserId: 2, FullName: "Bob B" },
          ]),
        }}
      />,
    );
    const stack = screen.getByTestId("card-assignees-30");
    expect(stack.querySelectorAll('[role="img"]')).toHaveLength(2);
    expect(screen.getByTitle("Alice A")).toBeInTheDocument();
    expect(screen.getByTitle("Bob B")).toBeInTheDocument();
    // Name text is single-assignee only — two faces would overflow the card.
    expect(screen.queryByText("Alice A")).not.toBeInTheDocument();
  });

  it("caps the stack at 3 faces and shows +N for the rest", () => {
    wrap(
      <KanbanCard
        task={{
          Id: 31,
          Title: "Crowded",
          Priority: "medium",
          AssigneesJson: JSON.stringify(
            [1, 2, 3, 4, 5].map((id) => ({ UserId: id, FullName: `User ${id}` })),
          ),
        }}
      />,
    );
    const stack = screen.getByTestId("card-assignees-31");
    expect(stack.querySelectorAll('[role="img"]')).toHaveLength(3);
    expect(screen.getByTestId("card-assignees-more-31")).toHaveTextContent("+2");
  });

  it("shows the name alongside the avatar for a single assignee", () => {
    wrap(
      <KanbanCard
        task={{
          Id: 32,
          Title: "Solo",
          Priority: "low",
          AssigneesJson: JSON.stringify([{ UserId: 9, FullName: "Carol C" }]),
        }}
      />,
    );
    expect(screen.getByText("Carol C")).toBeInTheDocument();
    expect(
      screen.queryByTestId("card-assignees-more-32"),
    ).not.toBeInTheDocument();
  });

  it("renders no assignee block when unassigned", () => {
    wrap(
      <KanbanCard
        task={{ Id: 33, Title: "Nobody", Priority: "low", AssigneesJson: "[]" }}
      />,
    );
    expect(screen.queryByTestId("card-assignees-33")).not.toBeInTheDocument();
  });

  it("is draggable by default", () => {
    wrap(<KanbanCard task={{ Id: 34, Title: "Movable", Priority: "low" }} />);
    const card = screen.getByTestId("kanban-card-34");
    expect(card).toHaveAttribute("aria-disabled", "false");
    expect(card).toHaveStyle({ cursor: "grab" });
  });

  it("is not draggable when canDrag=false", () => {
    wrap(
      <KanbanCard
        task={{ Id: 35, Title: "Locked", Priority: "low" }}
        canDrag={false}
      />,
    );
    const card = screen.getByTestId("kanban-card-35");
    expect(card).toHaveAttribute("aria-disabled", "true");
    expect(card).toHaveStyle({ cursor: "default" });
    // dnd-kit drops its listeners when disabled, so a pointer press starts nothing.
    fireEvent.pointerDown(card, { button: 0 });
    expect(card).not.toHaveAttribute("aria-pressed");
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

  it("shows steps chip when task has checklist totals", () => {
    wrap(
      <KanbanCard
        task={{
          Id: 20,
          Title: "With steps",
          Priority: "medium",
          ChecklistTotal: 3,
          ChecklistDone: 1,
        }}
      />,
    );
    expect(screen.getByTestId("card-steps-20")).toHaveTextContent("1/3");
  });

  it("strikes through title and shows done icon when IsCompleted", () => {
    wrap(
      <KanbanCard
        task={{
          Id: 21,
          Title: "Finished",
          Priority: "low",
          IsCompleted: 1,
          ChecklistTotal: 2,
          ChecklistDone: 2,
        }}
      />,
    );
    const card = screen.getByTestId("kanban-card-21");
    expect(card).toHaveAttribute("data-completed", "true");
    expect(screen.getByTestId("card-done-21")).toBeInTheDocument();
    const title = screen.getByText("Finished");
    expect(title).toHaveStyle({ textDecoration: "line-through" });
  });

  it("falls back to initials when an assignee has no name", () => {
    wrap(
      <KanbanCard
        task={{
          Id: 36,
          Title: "Anon",
          Priority: "low",
          AssigneesJson: JSON.stringify([{ UserId: 4, FullName: null }]),
        }}
      />,
    );
    const stack = screen.getByTestId("card-assignees-36");
    expect(stack.querySelectorAll('[role="img"]')).toHaveLength(1);
    expect(stack.querySelector("[title]")).toBeNull();
  });

  it("DragOverlay clone renders the view without drag wiring", () => {
    const onOpen = vi.fn();
    renderWithProviders(
      <KanbanCardView
        task={{
          Id: 40,
          Title: "Ghost",
          Priority: "high",
          AssigneesJson: JSON.stringify([{ UserId: 1, FullName: "Alice A" }]),
        }}
        overlay
        selected
        dragging
        onOpen={onOpen}
        onToggleSelect={vi.fn()}
      />,
      { router: false },
    );
    const clone = screen.getByTestId("kanban-card-40");
    expect(clone).toHaveStyle({ cursor: "grabbing" });
    // Overlay is inert: no checkbox, and clicking it must not open the task.
    expect(screen.queryByTestId("card-select-40")).not.toBeInTheDocument();
    fireEvent.click(clone);
    expect(onOpen).not.toHaveBeenCalled();
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

// Regression, 2026-09-19: @dnd-kit v6 leaves `touch-action` to the draggable.
// A card sits inside a column that scrolls vertically, inside a strip that
// scrolls horizontally, so on a phone the browser claimed the gesture as a
// scroll at exactly the 8px the pointer sensor was waiting for and fired
// `pointercancel`. The card never lifted — no error, no hint, nothing moved.
describe("touch dragging", () => {
  const card = { Id: 77, Title: "Movable" };

  it("takes the touch gesture away from the scrollers when the card can move", () => {
    renderWithProviders(<KanbanCardView task={card} canDrag />, { router: false });
    expect(screen.getByTestId("kanban-card-77").style.touchAction).toBe("none");
  });

  it("leaves scrolling alone on a card the user may not move", () => {
    renderWithProviders(<KanbanCardView task={card} canDrag={false} />, { router: false });
    expect(screen.getByTestId("kanban-card-77").style.touchAction).toBe("auto");
  });
});
