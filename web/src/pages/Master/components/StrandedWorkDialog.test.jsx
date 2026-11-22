import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import renderWithProviders from "../../../test/renderWithProviders";
import StrandedWorkDialog from "./StrandedWorkDialog";

describe("StrandedWorkDialog", () => {
  it("renders nothing when nobody is stranded", () => {
    renderWithProviders(<StrandedWorkDialog people={[]} onClose={() => {}} />);
    expect(screen.queryByText("Their manager has been told.")).toBeNull();
  });

  it("lists complaints then leads per person, singular and plural, and skips zero counts", () => {
    const onClose = vi.fn();
    renderWithProviders(
      <StrandedWorkDialog
        people={[
          { name: "Asha", leads: 1, complaints: 0 },
          { name: "Vivek", leads: 2, complaints: 1 },
        ]}
        onClose={onClose}
      />
    );
    expect(screen.getByText("1 open lead is still assigned to Asha")).toBeInTheDocument();
    expect(screen.queryByText(/complaint.* Asha/)).toBeNull();
    expect(screen.getByText("1 open complaint is still assigned to Vivek")).toBeInTheDocument();
    expect(screen.getByText("2 open leads are still assigned to Vivek")).toBeInTheDocument();
    expect(screen.getByText("Their manager has been told.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onClose).toHaveBeenCalled();
  });
});
