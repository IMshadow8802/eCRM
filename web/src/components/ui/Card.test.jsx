import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import Card from "./Card";

const wrap = (ui, mode = "light") =>
  render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);

describe("Card", () => {
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
