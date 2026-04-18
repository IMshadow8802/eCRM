import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";

import Button from "./Button";

const wrap = (ui, mode = "light") =>
  render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);

describe("Button", () => {
  it("renders children", () => {
    wrap(<Button>Submit</Button>);
    expect(screen.getByRole("button", { name: /submit/i })).toBeInTheDocument();
  });

  it("fires onClick when enabled", async () => {
    const onClick = vi.fn();
    wrap(<Button onClick={onClick}>Click</Button>);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    wrap(
      <Button disabled onClick={onClick}>
        X
      </Button>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not fire onClick when loading", async () => {
    const onClick = vi.fn();
    wrap(
      <Button loading onClick={onClick} data-testid="btn">
        Save
      </Button>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("btn"));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByTestId("btn")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("btn-spinner")).toBeInTheDocument();
  });

  it("renders all variants without crashing", () => {
    for (const variant of [
      "primary",
      "hero",
      "secondary",
      "tonal",
      "ghost",
      "destructive",
      "text",
    ]) {
      wrap(
        <Button variant={variant} data-testid={`btn-${variant}`}>
          {variant}
        </Button>,
      );
      expect(screen.getByTestId(`btn-${variant}`)).toBeInTheDocument();
    }
  });

  it("renders size variants", () => {
    for (const size of ["sm", "md", "lg"]) {
      wrap(
        <Button size={size} data-testid={`btn-${size}`}>
          sz
        </Button>,
      );
      expect(screen.getByTestId(`btn-${size}`)).toBeInTheDocument();
    }
  });

  it("renders left + right icons", () => {
    wrap(
      <Button
        leftIcon={<span data-testid="li">L</span>}
        rightIcon={<span data-testid="ri">R</span>}
      >
        hi
      </Button>,
    );
    expect(screen.getByTestId("li")).toBeInTheDocument();
    expect(screen.getByTestId("ri")).toBeInTheDocument();
  });

  it("honors fullWidth prop", () => {
    wrap(
      <Button fullWidth data-testid="fw">
        wide
      </Button>,
    );
    const btn = screen.getByTestId("fw");
    expect(btn).toHaveStyle({ width: "100%" });
  });

  it("falls through unknown variant to default primary-ish", () => {
    wrap(
      <Button variant="weirdo" data-testid="def">
        x
      </Button>,
    );
    expect(screen.getByTestId("def")).toBeInTheDocument();
  });

  it("renders in dark mode", () => {
    wrap(<Button data-testid="dark">Dark</Button>, "dark");
    expect(screen.getByTestId("dark")).toBeInTheDocument();
  });
});
