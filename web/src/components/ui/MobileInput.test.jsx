import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import MobileInput from "./MobileInput";
import renderWithProviders from "../../test/renderWithProviders";

describe("MobileInput", () => {
  it("is a numeric field", () => {
    renderWithProviders(<MobileInput label="Mobile" value="" onChange={() => {}} />);
    const input = screen.getByLabelText("Mobile");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "tel-national");
  });

  // No maxlength attribute, on purpose. A browser truncates a PASTE to
  // maxlength before any handler runs, so "+91 98250 12345" would arrive as
  // "+91 98250 " and clean down to a wrong number. The cap is applied in code,
  // after the prefix has been dropped.
  it("caps in code, not with a maxlength attribute", () => {
    renderWithProviders(<MobileInput label="Mobile" value="" onChange={() => {}} />);
    expect(screen.getByLabelText("Mobile")).not.toHaveAttribute("maxlength");
  });

  // onChange hands back the CLEANED STRING, not an event: every caller wants
  // the digits, and an event would make each of them strip it again.
  it("strips everything but digits as you type, and caps at ten", () => {
    const onChange = vi.fn();
    renderWithProviders(<MobileInput label="Mobile" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Mobile"), { target: { value: "98250-12 345xyz99" } });
    expect(onChange).toHaveBeenLastCalledWith("9825012345");
  });

  // A pasted "+91 98250 12345" is 12 digits. Cutting it to the FIRST ten would
  // keep the country code and drop the last two digits of the number.
  it("drops a pasted +91 or leading 0 instead of truncating the real number", () => {
    const onChange = vi.fn();
    renderWithProviders(<MobileInput label="Mobile" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Mobile"), { target: { value: "+91 98250 12345" } });
    expect(onChange).toHaveBeenLastCalledWith("9825012345");
    fireEvent.change(screen.getByLabelText("Mobile"), { target: { value: "098250 12345" } });
    expect(onChange).toHaveBeenLastCalledWith("9825012345");
  });

  it("shows an error and forwards the rest to TextInput", () => {
    renderWithProviders(<MobileInput label="Mobile" value="123" onChange={() => {}} error="Mobile number must be 10 digits" required data-testid="m" />);
    expect(screen.getByText("Mobile number must be 10 digits")).toBeInTheDocument();
    expect(screen.getByTestId("m")).toHaveValue("123");
  });
});
