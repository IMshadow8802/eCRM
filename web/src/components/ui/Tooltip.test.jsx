import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import Tooltip from "./Tooltip";

const wrap = (ui) => render(<ThemeProvider theme={buildTheme()}>{ui}</ThemeProvider>);

describe("Tooltip", () => {
  it("renders children", () => {
    wrap(
      <Tooltip title="Help">
        <button data-testid="b">hi</button>
      </Tooltip>,
    );
    expect(screen.getByTestId("b")).toBeInTheDocument();
  });

  it("returns children unchanged when no title", () => {
    wrap(
      <Tooltip>
        <button data-testid="b">hi</button>
      </Tooltip>,
    );
    expect(screen.getByTestId("b")).toBeInTheDocument();
  });
});
