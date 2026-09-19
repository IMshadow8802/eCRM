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

// Regression, 2026-09-19: the dialog's height cap was an inline
// `calc(100vh - 48px)`. `vh` is the viewport with a mobile browser's toolbars
// HIDDEN, so a tall form modal parked its footer underneath them — and Modal
// locks body scrolling, which removes the flick that would collapse those
// toolbars. Save was genuinely unreachable. The cap moved to a stylesheet
// class because a JS object cannot express the vh→dvh fallback: two identical
// keys silently collapse to the last one.
describe("height on a mobile browser", () => {
  it("takes its cap from the stylesheet class, not an inline vh", () => {
    wrap(<Modal open onClose={() => {}} title="T" data-testid="m"><Modal.Body>x</Modal.Body></Modal>);
    const dialog = screen.getByTestId("m");
    expect(dialog.className).toContain("ui-modal-dialog");
    expect(dialog.style.maxHeight).toBe("");
  });

  it("keeps a caller's own className alongside it", () => {
    wrap(
      <Modal open onClose={() => {}} title="T" className="mine" data-testid="m">
        <Modal.Body>x</Modal.Body>
      </Modal>,
    );
    expect(screen.getByTestId("m").className.split(/\s+/)).toEqual(
      expect.arrayContaining(["ui-modal-dialog", "mine"]),
    );
  });

  it("lets the footer's buttons wrap rather than run off the edge", () => {
    wrap(
      <Modal open onClose={() => {}} title="T">
        <Modal.Body>x</Modal.Body>
        <Modal.Footer><button type="button">Save</button></Modal.Footer>
      </Modal>,
    );
    expect(screen.getByRole("button", { name: "Save" }).parentElement.style.flexWrap).toBe("wrap");
  });
});
