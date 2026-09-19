import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LinesEditor from "./LinesEditor";
import renderWithProviders from "../../../../test/renderWithProviders";
import { computeQuote } from "../quoteMath";

const LINES = [
  { key: "a", productId: 7, description: "5 kW Rooftop", hsn: "8541", qty: 1, unit: "Set", rate: 280000, discountType: "amt", discountValue: 10000, taxPct: 12 },
  { key: "b", productId: null, description: "Installation", hsn: "", qty: 1, unit: "", rate: 20000, discountType: "pct", discountValue: "", taxPct: 18 },
];
const PRODUCTS = [{ Id: 9, Name: "AMC", Description: "5 years", HSNCode: "9987", Unit: "Yr", UnitPrice: 3000, TaxPct: 18 }];
const amounts = (lines) => computeQuote(lines, { sellerGstin: "24ABCDE1234F1Z5", sellerState: "24", buyerState: "24" });
const draw = (props = {}) => {
  const onChange = vi.fn();
  renderWithProviders(<LinesEditor lines={LINES} amounts={amounts(LINES)} products={PRODUCTS} onChange={onChange} {...props} />);
  return onChange;
};
const row = (i) => screen.getAllByTestId("quote-line")[i];

// Round-trips onChange back into lines, like every real caller — proves the
// "no lines yet" message actually appears through the UI, not just when the
// test hands the component an empty array directly.
function Controlled({ initial, ...rest }) {
  const [lines, setLines] = useState(initial);
  return <LinesEditor lines={lines} amounts={amounts(lines)} onChange={setLines} {...rest} />;
}

describe("LinesEditor", () => {
  it("shows each line with its computed taxable amount", () => {
    draw();
    expect(within(row(0)).getByLabelText("Description")).toHaveValue("5 kW Rooftop");
    expect(within(row(0)).getByTestId("line-amount")).toHaveTextContent("₹2,70,000.00");
    expect(within(row(1)).getByTestId("line-amount")).toHaveTextContent("₹20,000.00");
  });

  it("edits a field and reports the whole new list", () => {
    const onChange = draw();
    fireEvent.change(within(row(1)).getByLabelText("Rate"), { target: { value: "25000" } });
    expect(onChange).toHaveBeenLastCalledWith([LINES[0], { ...LINES[1], rate: "25000" }]);
  });

  it("switches a discount between % and ₹", () => {
    const onChange = draw();
    fireEvent.click(within(row(1)).getByRole("button", { name: "Discount in rupees" }));
    expect(onChange.mock.calls.at(-1)[0][1].discountType).toBe("amt");
  });

  it("adds a blank line, and removes one", () => {
    const onChange = draw();
    fireEvent.click(screen.getByRole("button", { name: /add line/i }));
    expect(onChange.mock.calls.at(-1)[0]).toHaveLength(3);
    expect(onChange.mock.calls.at(-1)[0][2]).toMatchObject({ description: "", qty: 1 });
    fireEvent.click(within(row(0)).getByRole("button", { name: "Remove line" }));
    expect(onChange.mock.calls.at(-1)[0].map((l) => l.key)).toEqual(["b"]);
  });

  it("moves a line up and down", () => {
    const onChange = draw();
    fireEvent.click(within(row(1)).getByRole("button", { name: "Move up" }));
    expect(onChange.mock.calls.at(-1)[0].map((l) => l.key)).toEqual(["b", "a"]);
    expect(within(row(0)).getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(within(row(1)).getByRole("button", { name: "Move down" })).toBeDisabled();
  });

  it("is read-only when disabled: no add, no remove, inputs locked", () => {
    draw({ disabled: true });
    expect(screen.queryByRole("button", { name: /add line/i })).toBeNull();
    expect(within(row(0)).getByLabelText("Description")).toBeDisabled();
  });

  it("says so when there are no lines yet", () => {
    renderWithProviders(<LinesEditor lines={[]} amounts={amounts([])} products={[]} onChange={() => {}} />);
    expect(screen.getByText(/no lines yet/i)).toBeInTheDocument();
  });

  it("adds a line from a picked product", async () => {
    const onChange = draw();
    const user = userEvent.setup();
    await user.click(screen.getByPlaceholderText("Add from products…"));
    await user.click(await screen.findByText("AMC"));
    expect(onChange.mock.calls.at(-1)[0][2]).toMatchObject({ productId: 9, description: "AMC — 5 years", hsn: "9987", rate: 3000, taxPct: 18 });
  });

  // sp_FinaliseQuotation refuses Rate < 0 — block it at entry too, so it never
  // reaches the server. A zero rate (a free replacement line) stays legal.
  it("refuses a negative rate", () => {
    const onChange = draw();
    fireEvent.change(within(row(1)).getByLabelText("Rate"), { target: { value: "-500" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(within(row(1)).getByLabelText("Rate"), { target: { value: "0" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("shows 'No lines yet' after removing the last remaining line, through the UI itself", () => {
    renderWithProviders(<Controlled initial={[LINES[1]]} products={PRODUCTS} />);
    expect(screen.getByTestId("quote-line")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove line" }));
    expect(screen.queryByTestId("quote-line")).toBeNull();
    expect(screen.getByText(/no lines yet/i)).toBeInTheDocument();
  });
});
