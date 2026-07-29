import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import TicketCard, { TicketCardView } from "./TicketCard";
import renderWithProviders from "../../test/renderWithProviders";

function wrap(ui) {
  return renderWithProviders(<DndContext>{ui}</DndContext>, { router: false });
}

const priorityById = new Map([[3, "High"]]);
const users = [{ Id: 7, FullName: "Jane Agent", Username: "jane" }];
const baseTicket = {
  Id: 100,
  TicketNo: "TKT-100",
  CustomerName: "Acme Corp",
  Priority: 3,
  StageId: 10,
  AssignedTo: 7,
};

describe("TicketCard", () => {
  it("renders TicketNo, customer, priority chip and assignee", () => {
    wrap(
      <TicketCard
        ticket={baseTicket}
        stageId={10}
        priorityById={priorityById}
        users={users}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("TKT-100")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByTestId("ticket-priority-100")).toHaveTextContent("High");
    expect(screen.getByText("Jane Agent")).toBeInTheDocument();
  });

  it("open button fires onOpen and stops propagation to the card", () => {
    const onOpen = vi.fn();
    wrap(
      <TicketCard
        ticket={baseTicket}
        stageId={10}
        priorityById={priorityById}
        users={users}
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByTestId("ticket-open-100"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(100);
  });

  it("clicking the card body opens the ticket", () => {
    const onOpen = vi.fn();
    wrap(
      <TicketCard
        ticket={baseTicket}
        stageId={10}
        priorityById={priorityById}
        users={users}
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByTestId("ticket-card-100"));
    expect(onOpen).toHaveBeenCalledWith(100);
  });

  it("shows Unassigned and no priority chip when those fields are missing", () => {
    wrap(
      <TicketCardView
        ticket={{ Id: 101, TicketNo: "TKT-101", Priority: 99, StageId: 20, AssignedTo: null }}
        priorityById={priorityById}
        users={users}
      />,
    );
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.queryByTestId("ticket-priority-101")).not.toBeInTheDocument();
    // No CustomerName row rendered.
    expect(screen.queryByText("Acme Corp")).not.toBeInTheDocument();
  });

  it("overlay clone renders no open button and is not clickable", () => {
    const onOpen = vi.fn();
    wrap(
      <TicketCardView
        ticket={baseTicket}
        priorityById={priorityById}
        users={users}
        onOpen={onOpen}
        overlay
        dragging
      />,
    );
    expect(screen.queryByTestId("ticket-open-100")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ticket-card-100"));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
