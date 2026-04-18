import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import Badge from "./Badge";

const wrap = (ui) => render(<ThemeProvider theme={buildTheme()}>{ui}</ThemeProvider>);

describe("Badge", () => {
  it("hides when count=0 and variant=numeric", () => {
    wrap(
      <Badge count={0} data-testid="b">
        <span>bell</span>
      </Badge>,
    );
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows count when > 0", () => {
    wrap(
      <Badge count={3} data-testid="b">
        <span>bell</span>
      </Badge>,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("displays max+ when count exceeds max", () => {
    wrap(
      <Badge count={150} max={99} data-testid="b">
        <span>bell</span>
      </Badge>,
    );
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("dot variant renders even when count=0", () => {
    wrap(
      <Badge count={0} variant="dot" data-testid="b">
        <span>x</span>
      </Badge>,
    );
    expect(screen.getByTestId("b")).toBeInTheDocument();
  });

  it("show=false hides badge", () => {
    wrap(
      <Badge count={5} show={false} data-testid="b">
        <span>x</span>
      </Badge>,
    );
    expect(screen.queryByText("5")).not.toBeInTheDocument();
  });

  it("different tones render", () => {
    for (const tone of ["primary", "accent", "success", "warning", "error", "info"]) {
      wrap(
        <Badge count={1} tone={tone} data-testid={`b-${tone}`}>
          <span>x</span>
        </Badge>,
      );
      expect(screen.getByTestId(`b-${tone}`)).toBeInTheDocument();
    }
  });

  it("pulse renders animated ring", () => {
    wrap(
      <Badge count={1} pulse data-testid="b">
        <span>x</span>
      </Badge>,
    );
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
