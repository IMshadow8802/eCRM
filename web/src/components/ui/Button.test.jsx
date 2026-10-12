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

  /**
   * Regression: the spinner was `position: absolute; left: <paddingInline>` —
   * pinned to the left padding edge where a leftIcon would sit. With the label
   * hidden, a fullWidth button showed a small spinner jammed against its left
   * edge and nothing else. It has to be centred on both axes, which means
   * left/top 50% plus a translate back by half its own size.
   */
  it("centres the spinner rather than pinning it to the left edge", () => {
    wrap(
      <Button loading fullWidth size="lg" data-testid="btn">
        Sign in
      </Button>,
    );
    const layer = screen.getByTestId("btn-spinner-layer");
    expect(layer).toHaveStyle({ position: "absolute", display: "flex", alignItems: "center", justifyContent: "center" });
    expect(["0", "0px"]).toContain(layer.style.inset);
    expect(layer).toContainElement(screen.getByTestId("btn-spinner"));
  });

  /**
   * Regression (2026-10-11): the spinner centred itself with
   * `transform: translate(-50%, -50%)`, but MUI's indeterminate spinner
   * animates `transform: rotate()` on the same element and the keyframes won,
   * so every loading spinner sat down-right of centre. The spinner itself must
   * carry no positioning transform; the layer centres it.
   */
  it("does not position the spinner with a transform the rotation would replace", () => {
    wrap(<Button loading data-testid="btn">Save</Button>);
    const spinner = screen.getByTestId("btn-spinner");
    expect(spinner.style.transform).toBe("");
    expect(getComputedStyle(spinner).position).not.toBe("absolute");
  });

  it("keeps its width while loading: the label stays in flow, hidden, on one line", () => {
    wrap(<Button loading data-testid="btn">Save changes</Button>);
    const label = screen.getByText("Save changes");
    expect(label.style.visibility).toBe("hidden");
    expect(label.style.whiteSpace).toBe("nowrap");
    expect(screen.getByTestId("btn")).toHaveAttribute("aria-busy", "true");
  });

  it("small is 32 high, flush with a small input", () => {
    wrap(<Button size="sm" data-testid="btn">Go</Button>);
    expect(screen.getByTestId("btn").style.minHeight).toBe(`${32 / 15}rem`);
  });

  it("keeps the label in the layout while loading so the button cannot resize", () => {
    // Hidden, not unmounted — removing it would collapse the button to the
    // width of the spinner and make it jump on every submit.
    wrap(<Button loading>Sign in</Button>);
    expect(screen.getByText("Sign in")).toBeInTheDocument();
  });

  it("renders all variants without crashing", () => {
    for (const variant of [
      "primary",
      "hero",
      "secondary",
      "tonal",
      "outlined",
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
  it("draws disabled as solid grey, not a faded variant", () => {
    wrap(<Button disabled data-testid="d">Save</Button>);
    const el = screen.getByTestId("d");
    expect(el.style.opacity).toBe("");
    expect(el.style.color).not.toBe("");
  });
});
