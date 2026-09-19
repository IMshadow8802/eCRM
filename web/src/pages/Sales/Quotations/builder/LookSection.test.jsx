import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";

import LookSection from "./LookSection";
import { TEMPLATES } from "../templates";
import { ACCENTS } from "../quoteForm";
import renderWithProviders from "../../../../test/renderWithProviders";

const show = (props = {}) => {
  const onTemplate = vi.fn();
  const onAccent = vi.fn();
  renderWithProviders(<LookSection templateCode="modern" accent={ACCENTS[0]} onTemplate={onTemplate} onAccent={onAccent} {...props} />);
  return { onTemplate, onAccent };
};

describe("LookSection", () => {
  it("offers every shipped template and marks the one in use", () => {
    show();
    expect(screen.getAllByRole("radio")).toHaveLength(TEMPLATES.length);
    expect(screen.getByTestId("template-modern")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("template-classic")).toHaveAttribute("aria-checked", "false");
  });

  it("reports the template that was picked", () => {
    const { onTemplate } = show();
    fireEvent.click(screen.getByTestId("template-minimal"));
    expect(onTemplate).toHaveBeenCalledWith("minimal");
  });

  it("reports a preset accent, and marks the one in use", () => {
    const { onAccent } = show();
    expect(screen.getByLabelText(`Accent ${ACCENTS[0]}`)).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByLabelText(`Accent ${ACCENTS[2]}`));
    expect(onAccent).toHaveBeenCalledWith(ACCENTS[2]);
  });

  // This is THEIR document: the six presets are a shortcut, not a limit.
  it("takes any colour from the browser's own picker", () => {
    const { onAccent } = show();
    fireEvent.change(screen.getByLabelText("Custom accent"), { target: { value: "#ff0000" } });
    expect(onAccent).toHaveBeenCalledWith("#ff0000");
  });

  it("offers nothing to press once the quotation is issued", () => {
    show({ disabled: true });
    expect(screen.getByTestId("template-classic")).toBeDisabled();
    expect(screen.getByLabelText(`Accent ${ACCENTS[0]}`)).toBeDisabled();
    expect(screen.getByLabelText("Custom accent")).toBeDisabled();
  });
});
