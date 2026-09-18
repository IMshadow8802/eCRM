import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import Card from "./Card";

const wrap = (ui, mode = "light") =>
  render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);

describe("Card", () => {

  /**
   * REGRESSION: the default card was transparent.
   *
   * The style object set `backgroundColor: bg` and then, two lines later,
   * `background: variant === "gradient" ? bg : undefined`. `background` is the
   * shorthand for `background-color`, so the later key won and the colour was
   * dropped from the rendered inline style entirely — the DOM came out with
   * padding, radius, border and shadow but no background at all.
   *
   * Every non-gradient card in the app was therefore showing the page through
   * itself. It was invisible wherever the page happened to be white and obvious
   * on the dashboard, where four transparent KPI cards sat above bento tiles
   * that painted their own background through MUI's sx and so really were
   * white. Same component, two results, which is how it got reported: "the top
   * 4 cards are not white, they look different."
   *
   * One key now carries the paint, and it takes a colour or a gradient equally.
   */
  it.each(["default", "flat", "outlined", "ghost"])(
    "actually paints a background for variant=%s",
    (variant) => {
      const { container } = wrap(<Card variant={variant}>x</Card>);
      const bg = getComputedStyle(container.firstElementChild).background;
      expect(bg).not.toBe("");
      expect(bg).not.toContain("rgba(0, 0, 0, 0)");
    },
  );

  it("still paints the gradient variant with its gradient", () => {
    const { container } = wrap(<Card variant="gradient">x</Card>);
    expect(getComputedStyle(container.firstElementChild).backgroundImage).toContain(
      "linear-gradient",
    );
  });
  it("renders children", () => {
    wrap(<Card data-testid="c">hello</Card>);
    expect(screen.getByTestId("c")).toHaveTextContent("hello");
  });

  it("onClick fires + role=button", () => {
    const onClick = vi.fn();
    wrap(
      <Card onClick={onClick} data-testid="c">
        x
      </Card>,
    );
    const card = screen.getByTestId("c");
    expect(card).toHaveAttribute("role", "button");
    fireEvent.click(card);
    expect(onClick).toHaveBeenCalled();
  });

  it("keyboard Enter/Space triggers onClick", () => {
    const onClick = vi.fn();
    wrap(
      <Card onClick={onClick} data-testid="c">
        x
      </Card>,
    );
    const card = screen.getByTestId("c");
    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("all variants render", () => {
    for (const v of ["default", "flat", "ghost", "outlined", "gradient"]) {
      wrap(
        <Card variant={v} data-testid={`c-${v}`}>
          {v}
        </Card>,
      );
      expect(screen.getByTestId(`c-${v}`)).toBeInTheDocument();
    }
  });

  it("padding presets render", () => {
    for (const pad of ["none", "sm", "md", "lg", "xl"]) {
      wrap(
        <Card padding={pad} data-testid={`c-${pad}`}>
          x
        </Card>,
      );
      expect(screen.getByTestId(`c-${pad}`)).toBeInTheDocument();
    }
  });

  it("interactive adds role=button only when onClick", () => {
    wrap(
      <Card interactive data-testid="i">
        x
      </Card>,
    );
    expect(screen.getByTestId("i")).not.toHaveAttribute("role", "button");
  });

  it("dark mode", () => {
    wrap(<Card data-testid="d">x</Card>, "dark");
    expect(screen.getByTestId("d")).toBeInTheDocument();
  });
});
