import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RemarksModal from "./RemarksModal";
import renderWithProviders from "../../test/renderWithProviders";

const renderModal = (props = {}) =>
  renderWithProviders(
    <RemarksModal open onClose={vi.fn()} title="Reject complaint" submitLabel="Reject" onSubmit={vi.fn()} {...props} />,
    { router: false },
  );

describe("RemarksModal", () => {
  it("refuses to submit without remarks and hands back the trimmed text", async () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });
    const user = userEvent.setup();

    expect(screen.getByText("Reject complaint")).toBeInTheDocument();
    expect(screen.getByTestId("remarks-submit")).toBeDisabled();
    await user.type(screen.getByTestId("remarks-input"), "   ");
    expect(screen.getByTestId("remarks-submit")).toBeDisabled();   // whitespace is not a remark

    await user.type(screen.getByTestId("remarks-input"), "  Never reproducible  ");
    await user.click(screen.getByTestId("remarks-submit"));
    expect(onSubmit).toHaveBeenCalledWith("Never reproducible");
  });

  it("allows an empty submit when the caller says remarks are optional", async () => {
    const onSubmit = vi.fn();
    renderModal({ required: false, submitLabel: "Close", onSubmit });
    await userEvent.setup().click(screen.getByTestId("remarks-submit"));
    expect(onSubmit).toHaveBeenCalledWith("");
  });

  // renderWithProviders wraps the tree inline (not via RTL's `wrapper:`
  // option), so RTL's own `rerender` would drop the ThemeProvider and crash
  // on `theme.tokens` — two fresh renders instead (see ReportShell.test.jsx).
  it("Cancel closes without submitting", async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    renderModal({ onClose, onSubmit });
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("busy locks both buttons", () => {
    renderModal({ busy: true });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByTestId("remarks-submit")).toBeDisabled();
  });

  it("renders nothing while closed", () => {
    renderModal({ open: false });
    expect(screen.queryByTestId("remarks-modal")).toBeNull();
  });
});
