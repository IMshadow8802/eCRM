import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";

import IconButton from "./IconButton";

const wrap = (ui, mode = "light") =>
  render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);

describe("IconButton", () => {
  it("renders + fires onClick", async () => {
    const onClick = vi.fn();
    wrap(
      <IconButton onClick={onClick} data-testid="ib" aria-label="save">
        <span>i</span>
      </IconButton>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("ib"));
    expect(onClick).toHaveBeenCalled();
  });

  it("tooltip wraps the button when provided", async () => {
    wrap(
      <IconButton tooltip="Edit" data-testid="ib">
        <span>i</span>
      </IconButton>,
    );
    const btn = screen.getByTestId("ib");
    expect(btn).toHaveAttribute("aria-label", "Edit");
  });

  it("renders all variants + sizes", () => {
    for (const variant of ["ghost", "tonal", "solid", "destructive"]) {
      for (const size of ["sm", "md", "lg"]) {
        wrap(
          <IconButton
            variant={variant}
            size={size}
            data-testid={`${variant}-${size}`}
          >
            <span>i</span>
          </IconButton>,
        );
        expect(screen.getByTestId(`${variant}-${size}`)).toBeInTheDocument();
      }
    }
  });

  it("blocks clicks when disabled", async () => {
    const onClick = vi.fn();
    wrap(
      <IconButton disabled onClick={onClick} data-testid="d">
        <span>i</span>
      </IconButton>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("d"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders in dark mode", () => {
    wrap(
      <IconButton data-testid="dark">
        <span>i</span>
      </IconButton>,
      "dark",
    );
    expect(screen.getByTestId("dark")).toBeInTheDocument();
  });
});
