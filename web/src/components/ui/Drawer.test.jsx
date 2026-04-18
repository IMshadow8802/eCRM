import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import Drawer from "./Drawer";

const wrap = (ui) => render(<ThemeProvider theme={buildTheme()}>{ui}</ThemeProvider>);

describe("Drawer", () => {
  it("renders nothing closed", () => {
    wrap(
      <Drawer open={false} onClose={() => {}} data-testid="d">
        x
      </Drawer>,
    );
    expect(screen.queryByTestId("d")).not.toBeInTheDocument();
  });

  it("renders children when open", () => {
    wrap(
      <Drawer open onClose={() => {}} data-testid="d">
        hello
      </Drawer>,
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("backdrop click closes by default", () => {
    const onClose = vi.fn();
    wrap(
      <Drawer open onClose={onClose} data-testid="d">
        x
      </Drawer>,
    );
    fireEvent.click(screen.getByTestId("d-backdrop"));
    expect(onClose).toHaveBeenCalled();
  });

  it("dismissOnBackdrop=false blocks close", () => {
    const onClose = vi.fn();
    wrap(
      <Drawer open onClose={onClose} dismissOnBackdrop={false} data-testid="d">
        x
      </Drawer>,
    );
    fireEvent.click(screen.getByTestId("d-backdrop"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape closes", () => {
    const onClose = vi.fn();
    wrap(
      <Drawer open onClose={onClose} data-testid="d">
        x
      </Drawer>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("left side renders", () => {
    wrap(
      <Drawer open side="left" onClose={() => {}} data-testid="d">
        left
      </Drawer>,
    );
    expect(screen.getByText("left")).toBeInTheDocument();
  });
});
