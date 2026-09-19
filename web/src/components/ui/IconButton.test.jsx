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

  it("tone overrides the variant colour and is exposed as data-tone", () => {
    const hexToRgb = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    wrap(
      <IconButton tone="success" data-testid="toned">
        <span>i</span>
      </IconButton>,
    );
    const btn = screen.getByTestId("toned");
    expect(btn).toHaveAttribute("data-tone", "success");
    expect(btn.style.color).toBe(
      hexToRgb(buildTheme("light").tokens.success.main),
    );
  });

  it("carries no data-tone when tone is absent", () => {
    wrap(
      <IconButton data-testid="plain">
        <span>i</span>
      </IconButton>,
    );
    expect(screen.getByTestId("plain")).not.toHaveAttribute("data-tone");
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

// Regression, 2026-09-19: `sm` was 28px. Row actions use it four-wide with a
// 4px gap (Tickets, Leads, Customers), which is below any touch-target floor
// and puts Delete a mis-tap away from View.
it("keeps the small size at a tappable 32px", () => {
  wrap(
    <IconButton size="sm" aria-label="Delete"><span /></IconButton>,
  );
  const btn = screen.getByRole("button", { name: "Delete" });
  expect(btn.style.width).toBe("32px");
  expect(btn.style.height).toBe("32px");
});
