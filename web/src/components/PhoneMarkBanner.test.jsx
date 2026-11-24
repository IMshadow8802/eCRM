import { describe, it, expect } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import PhoneMarkBanner, { PhoneMarkDot } from "./PhoneMarkBanner";
import renderWithProviders from "../test/renderWithProviders";

describe("PhoneMarkBanner", () => {
  it("do not call: red alert with the note, who and when", () => {
    renderWithProviders(<PhoneMarkBanner mark="dnc" note="Asked never to be called" by="Priya Verma" at="2026-11-22T17:22:00" />);
    const b = screen.getByRole("alert");
    expect(b).toHaveTextContent("Do not call — Asked never to be called · marked by Priya Verma, 22-11-2026");
  });

  it("caution: amber status with the note", () => {
    renderWithProviders(<PhoneMarkBanner mark="caution" note="Speaks only Punjabi" />);
    expect(screen.getByRole("status")).toHaveTextContent("Call with caution — Speaks only Punjabi");
  });

  it("nothing without a mark, and just the words without a note", () => {
    const { container } = renderWithProviders(<PhoneMarkBanner mark={null} note="x" />);
    expect(container).toBeEmptyDOMElement();
    renderWithProviders(<PhoneMarkBanner mark="dnc" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/^Do not call$/);
  });

  it("a row dot says what the mark is", async () => {
    renderWithProviders(<><PhoneMarkDot mark="caution" /><PhoneMarkDot mark={null} /></>);
    expect(screen.getAllByTestId("phone-mark-dot")).toHaveLength(1);
    fireEvent.mouseOver(screen.getByTestId("phone-mark-dot"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Call with caution");
  });
});
