import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import Progress from "./Progress";

const wrap = (ui) => render(<ThemeProvider theme={buildTheme()}>{ui}</ThemeProvider>);

describe("Progress", () => {
  it("renders with value and label", () => {
    wrap(<Progress value={42} label="Loading" data-testid="p" />);
    expect(screen.getByText("Loading")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
  });

  it("clamps value to 0-100", () => {
    wrap(<Progress value={150} data-testid="p" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  });

  it("indeterminate omits aria-valuenow", () => {
    wrap(<Progress indeterminate data-testid="p" />);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute(
      "aria-valuenow",
    );
  });

  it("size variants", () => {
    for (const size of ["sm", "md", "lg"]) {
      wrap(<Progress value={10} size={size} data-testid={`p-${size}`} />);
      expect(screen.getByTestId(`p-${size}`)).toBeInTheDocument();
    }
  });

  it("tone variants", () => {
    for (const tone of ["primary", "success", "warning", "error"]) {
      wrap(<Progress value={10} tone={tone} data-testid={`p-${tone}`} />);
      expect(screen.getByTestId(`p-${tone}`)).toBeInTheDocument();
    }
  });

  it("hides % label when indeterminate + label", () => {
    wrap(<Progress indeterminate label="Saving" data-testid="p" />);
    expect(screen.getByText("Saving")).toBeInTheDocument();
    expect(screen.queryByText("%")).not.toBeInTheDocument();
  });
});
