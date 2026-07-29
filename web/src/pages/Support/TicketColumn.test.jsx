import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import renderWithProviders from "../../test/renderWithProviders";

// Force the drop-target + draggable branches: jsdom can't drive a real drag,
// so stub the hooks to report an active hover. Covers the isDropTarget=true
// styling the board test (hook idle) never reaches.
vi.mock("@dnd-kit/core", () => ({
  useDroppable: () => ({ setNodeRef: () => {}, isOver: true }),
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    isDragging: false,
  }),
}));

import TicketColumn from "./TicketColumn";

describe("TicketColumn", () => {
  it("renders stage name, count and its tickets, incl. a color-less stage while hovered", () => {
    renderWithProviders(
      <TicketColumn
        stage={{ Id: 10, Name: "Open", SortOrder: 1 }} // no Color -> fallback branch
        tickets={[
          { Id: 100, TicketNo: "TKT-100", Priority: 3, StageId: 10, AssignedTo: null },
        ]}
        priorityById={new Map()}
        users={[]}
        onOpen={vi.fn()}
      />,
      { router: false },
    );
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByTestId("ticket-card-100")).toBeInTheDocument();
  });
});
