import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import Avatar from "./Avatar";

const wrap = (ui) => render(<ThemeProvider theme={buildTheme()}>{ui}</ThemeProvider>);

describe("Avatar", () => {
  it("renders initials from name", () => {
    wrap(<Avatar name="Alice Bob" data-testid="a" />);
    expect(screen.getByText("AB")).toBeInTheDocument();
  });

  it("renders ? for no name", () => {
    wrap(<Avatar data-testid="a" />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("renders img when src given", () => {
    wrap(<Avatar name="X" src="/pic.png" data-testid="a" />);
    const img = screen.getByAltText("X");
    expect(img.tagName).toBe("IMG");
    expect(img).toHaveAttribute("src", "/pic.png");
  });

  it("size presets render", () => {
    for (const size of ["xs", "sm", "md", "lg", "xl"]) {
      wrap(<Avatar name="S" size={size} data-testid={`a-${size}`} />);
      expect(screen.getByTestId(`a-${size}`)).toBeInTheDocument();
    }
  });

  it("online dot renders when online=true", () => {
    wrap(<Avatar name="X" online data-testid="a" />);
    expect(screen.getByLabelText("online")).toBeInTheDocument();
  });

  it("offline dot when online=false", () => {
    wrap(<Avatar name="X" online={false} data-testid="a" />);
    expect(screen.getByLabelText("offline")).toBeInTheDocument();
  });

  it("ring variant renders without crash", () => {
    wrap(<Avatar name="X" ring data-testid="a" />);
    expect(screen.getByTestId("a")).toBeInTheDocument();
  });

  it("onClick fires + role=button", () => {
    const onClick = vi.fn();
    wrap(<Avatar name="X" onClick={onClick} data-testid="a" />);
    fireEvent.click(screen.getByRole("button", { name: "X" }));
    expect(onClick).toHaveBeenCalled();
  });

  it("renders an emoji preset instead of initials", () => {
    wrap(<Avatar name="Alice Bob" preset="emoji:🚀" data-testid="a" />);
    expect(screen.getByText("🚀")).toBeInTheDocument();
    expect(screen.queryByText("AB")).not.toBeInTheDocument();
  });

  it("renders an icon preset on its color (no initials)", () => {
    wrap(<Avatar name="Alice Bob" preset="icon:rocket|blue" data-testid="a" />);
    // lucide renders an <svg>; initials should be gone
    expect(screen.queryByText("AB")).not.toBeInTheDocument();
    expect(screen.getByTestId("a").querySelector("svg")).toBeTruthy();
  });

  it("falls back to initials when the preset is malformed", () => {
    wrap(<Avatar name="Alice Bob" preset="icon:notreal|blue" data-testid="a" />);
    expect(screen.getByText("AB")).toBeInTheDocument();
  });
});
