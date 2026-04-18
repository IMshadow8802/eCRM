import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import Chip from "./Chip";

const wrap = (ui, mode = "light") =>
  render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);

describe("Chip", () => {
  it("renders label", () => {
    wrap(<Chip label="Active" data-testid="c" />);
    expect(screen.getByTestId("c")).toHaveTextContent("Active");
  });

  it("all tones + variants render", () => {
    const tones = ["default", "primary", "accent", "success", "warning", "error", "info"];
    const variants = ["solid", "tonal", "outlined", "ghost"];
    for (const tone of tones) {
      for (const variant of variants) {
        wrap(
          <Chip
            label="x"
            tone={tone}
            variant={variant}
            data-testid={`c-${tone}-${variant}`}
          />,
        );
        expect(screen.getByTestId(`c-${tone}-${variant}`)).toBeInTheDocument();
      }
    }
  });

  it("unknown tone falls back to default", () => {
    wrap(<Chip label="x" tone="weird" data-testid="c" />);
    expect(screen.getByTestId("c")).toBeInTheDocument();
  });

  it("sizes sm/md/lg render", () => {
    for (const size of ["sm", "md", "lg"]) {
      wrap(<Chip label="s" size={size} data-testid={`c-${size}`} />);
      expect(screen.getByTestId(`c-${size}`)).toBeInTheDocument();
    }
  });

  it("onClick + role=button", () => {
    const onClick = vi.fn();
    wrap(<Chip label="x" onClick={onClick} data-testid="c" />);
    fireEvent.click(screen.getByTestId("c"));
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByTestId("c")).toHaveAttribute("role", "button");
  });

  it("onDelete fires and stops propagation", () => {
    const onClick = vi.fn();
    const onDelete = vi.fn();
    wrap(
      <Chip
        label="x"
        onClick={onClick}
        onDelete={onDelete}
        data-testid="c"
      />,
    );
    fireEvent.click(screen.getByTestId("c-remove"));
    expect(onDelete).toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders icon when provided", () => {
    wrap(
      <Chip
        label="x"
        icon={<span data-testid="ic">i</span>}
        data-testid="c"
      />,
    );
    expect(screen.getByTestId("ic")).toBeInTheDocument();
  });
});
