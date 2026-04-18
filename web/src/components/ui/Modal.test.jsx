import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import Modal from "./Modal";
import { Bell } from "lucide-react";

const wrap = (ui, mode = "light") =>
  render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);

describe("Modal", () => {
  it("renders nothing when open=false", () => {
    wrap(
      <Modal open={false} onClose={() => {}} data-testid="m">
        <Modal.Body>hi</Modal.Body>
      </Modal>,
    );
    expect(screen.queryByTestId("m")).not.toBeInTheDocument();
  });

  it("renders header + body + footer when open", () => {
    wrap(
      <Modal open onClose={() => {}} data-testid="m">
        <Modal.Header title="Hi" subtitle="Sub" icon={<Bell size={18} />} onClose={() => {}} />
        <Modal.Body>body text</Modal.Body>
        <Modal.Footer>footer text</Modal.Footer>
      </Modal>,
    );
    expect(screen.getByText("Hi")).toBeInTheDocument();
    expect(screen.getByText("Sub")).toBeInTheDocument();
    expect(screen.getByText("body text")).toBeInTheDocument();
    expect(screen.getByText("footer text")).toBeInTheDocument();
  });

  it("backdrop click closes by default", () => {
    const onClose = vi.fn();
    wrap(
      <Modal open onClose={onClose} data-testid="m">
        <Modal.Body>x</Modal.Body>
      </Modal>,
    );
    fireEvent.click(screen.getByTestId("m-backdrop"));
    expect(onClose).toHaveBeenCalled();
  });

  it("dismissOnBackdrop=false prevents backdrop close", () => {
    const onClose = vi.fn();
    wrap(
      <Modal open onClose={onClose} dismissOnBackdrop={false} data-testid="m">
        <Modal.Body>x</Modal.Body>
      </Modal>,
    );
    fireEvent.click(screen.getByTestId("m-backdrop"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape key closes", () => {
    const onClose = vi.fn();
    wrap(
      <Modal open onClose={onClose} data-testid="m">
        <Modal.Body>x</Modal.Body>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("dismissOnEscape=false blocks escape", () => {
    const onClose = vi.fn();
    wrap(
      <Modal open onClose={onClose} dismissOnEscape={false} data-testid="m">
        <Modal.Body>x</Modal.Body>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("size presets render", () => {
    for (const size of ["sm", "md", "lg", "xl"]) {
      wrap(
        <Modal open onClose={() => {}} size={size} data-testid={`m-${size}`}>
          <Modal.Body>{size}</Modal.Body>
        </Modal>,
      );
      expect(screen.getByTestId(`m-${size}`)).toBeInTheDocument();
    }
  });

  it("Header close button fires", () => {
    const onClose = vi.fn();
    wrap(
      <Modal open onClose={() => {}} data-testid="m">
        <Modal.Header title="T" onClose={onClose} />
      </Modal>,
    );
    fireEvent.click(screen.getByTestId("modal-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("Footer align variants render", () => {
    for (const align of ["left", "between", "right"]) {
      wrap(
        <Modal open onClose={() => {}} data-testid={`m-${align}`}>
          <Modal.Footer align={align}>x</Modal.Footer>
        </Modal>,
      );
      expect(screen.getByTestId(`m-${align}`)).toBeInTheDocument();
    }
  });
});
