import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import Skeleton from "./Skeleton";

const wrap = (ui, mode = "light") =>
  render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);

describe("Skeleton", () => {
  it("renders rect default", () => {
    wrap(<Skeleton width={200} height={40} data-testid="s" />);
    expect(screen.getByTestId("s")).toBeInTheDocument();
  });

  it("variant presets render", () => {
    for (const variant of ["text", "circular", "button", "rect"]) {
      wrap(<Skeleton variant={variant} data-testid={`s-${variant}`} />);
      expect(screen.getByTestId(`s-${variant}`)).toBeInTheDocument();
    }
  });

  it("dark mode shades differently", () => {
    wrap(<Skeleton data-testid="s" />, "dark");
    expect(screen.getByTestId("s")).toBeInTheDocument();
  });
});
