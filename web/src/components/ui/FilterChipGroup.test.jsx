import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import FilterChipGroup from "./FilterChipGroup";

const wrap = (ui) => render(<ThemeProvider theme={buildTheme()}>{ui}</ThemeProvider>);

describe("FilterChipGroup", () => {
  it("renders nothing when empty", () => {
    const { container } = wrap(<FilterChipGroup filters={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders chips + removes on click", () => {
    const onRemoveA = vi.fn();
    const onRemoveB = vi.fn();
    wrap(
      <FilterChipGroup
        filters={[
          { id: "a", label: "Status: Open", onRemove: onRemoveA },
          { id: "b", label: "Priority: High", tone: "error", onRemove: onRemoveB },
        ]}
        data-testid="fg"
      />,
    );
    expect(screen.getByTestId("fg-a")).toBeInTheDocument();
    expect(screen.getByTestId("fg-b")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("fg-a-remove"));
    expect(onRemoveA).toHaveBeenCalled();
  });

  it("Clear all button fires onClear when 2+ filters", () => {
    const onClear = vi.fn();
    wrap(
      <FilterChipGroup
        filters={[
          { id: "a", label: "A", onRemove: () => {} },
          { id: "b", label: "B", onRemove: () => {} },
        ]}
        onClear={onClear}
        data-testid="fg"
      />,
    );
    fireEvent.click(screen.getByTestId("fg-clear-all"));
    expect(onClear).toHaveBeenCalled();
  });

  it("hides Clear all when only one filter", () => {
    wrap(
      <FilterChipGroup
        filters={[{ id: "a", label: "A", onRemove: () => {} }]}
        onClear={() => {}}
        data-testid="fg"
      />,
    );
    expect(screen.queryByTestId("fg-clear-all")).not.toBeInTheDocument();
  });
});
