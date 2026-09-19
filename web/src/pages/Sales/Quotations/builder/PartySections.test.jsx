import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CompanySection, CustomerSection } from "./PartySections";
import renderWithProviders from "../../../../test/renderWithProviders";

const company = (over = {}) => ({
  name: "Solar Care", gstin: "", stateCode: "", phone: "", email: "", website: "",
  address: "", city: "", pincode: "", signatory: "", bank: "", ...over,
});
const customer = (over = {}) => ({
  ToName: "Ramesh", ToCompany: "", ToMobile: "", ToEmail: "", ToAddress: "",
  ToCity: "", ToStateCode: "", ToPincode: "", ToGSTIN: "", ...over,
});

const showCompany = (value, props = {}) => {
  const onChange = vi.fn();
  renderWithProviders(<CompanySection value={company(value)} onChange={onChange} {...props} />);
  return onChange;
};
const showCustomer = (value, props = {}) => {
  const onChange = vi.fn();
  renderWithProviders(<CustomerSection value={customer(value)} onChange={onChange} {...props} />);
  return onChange;
};

// A required field's label carries a "*", so these match on the prefix.
const type = (label, text) => fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value: text } });

describe("CompanySection", () => {
  // The GSTIN already says which state issued it; asking again only invites a
  // second answer that disagrees with the first.
  it("reads the state off a valid GSTIN and locks the picker", () => {
    showCompany({ gstin: "24ABCDE1234F1Z5", stateCode: "27" });
    expect(screen.getByTestId("company-state-input")).toHaveValue("Gujarat (24)");
    expect(screen.getByTestId("company-state-input")).toBeDisabled();
    expect(screen.queryByText(/not GST-registered/i)).toBeNull();
  });

  it("offers the no-GST hint while the GSTIN is empty, and falls back to the typed state", () => {
    showCompany({ stateCode: "27" });
    expect(screen.getByText(/Leave empty if you are not GST-registered/i)).toBeInTheDocument();
    expect(screen.getByTestId("company-state-input")).toHaveValue("Maharashtra (27)");
    expect(screen.getByTestId("company-state-input")).not.toBeDisabled();
  });

  it("flags a GSTIN that is not a GSTIN, and leaves the state pickable", () => {
    showCompany({ gstin: "24ABC" });
    expect(screen.getByText("15 characters, e.g. 24ABCDE1234F1Z5")).toBeInTheDocument();
    expect(screen.getByTestId("company-state-input")).toHaveValue("");
    expect(screen.getByTestId("company-state-input")).not.toBeDisabled();
  });

  it.each([
    ["Company name", "name", "Solar Care Pvt Ltd"],
    ["GSTIN", "gstin", "24ABCDE1234F1Z5"],
    ["Phone", "phone", "079 2658"],
    ["Email", "email", "hello@solar.in"],
    ["Website", "website", "solar.in"],
    ["Address", "address", "402 Titanium"],
    ["City", "city", "Ahmedabad"],
    ["Pincode", "pincode", "380015"],
    ["Signatory", "signatory", "Amit Shah"],
    ["Bank details", "bank", "HDFC 123"],
  ])("patches %s onto the block it belongs to", (label, key, text) => {
    const onChange = showCompany();
    type(label, text);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ [key]: text }));
  });

  it("picks a state", async () => {
    const onChange = showCompany();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("company-state-input"));
    await user.click(await screen.findByText("Karnataka (29)"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ stateCode: "29" }));
  });

  it("empties the state when the picker is cleared", async () => {
    const onChange = showCompany({ stateCode: "29" });
    await userEvent.setup().click(screen.getByTitle("Clear"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ stateCode: "" }));
  });

  it("stops every field when the quotation is no longer editable", () => {
    showCompany({}, { disabled: true });
    expect(screen.getByLabelText("Phone")).toBeDisabled();
    expect(screen.getByTestId("company-state-input")).toBeDisabled();
  });
});

describe("CustomerSection", () => {
  it("explains what the place of supply decides only when there is tax to decide", () => {
    showCustomer({}, { taxed: true });
    expect(screen.getByText(/Same state as yours/i)).toBeInTheDocument();
  });

  it("says nothing about GST for an unregistered seller", () => {
    showCustomer({}, { taxed: false });
    expect(screen.queryByText(/Same state as yours/i)).toBeNull();
  });

  it("flags a customer GSTIN that is not a GSTIN", () => {
    showCustomer({ ToGSTIN: "27AAA" });
    expect(screen.getByText("15 characters, e.g. 27AAAAA0000A1Z5")).toBeInTheDocument();
  });

  it("keeps only the digits of a mobile number", () => {
    const onChange = showCustomer();
    type("Mobile", "98250-12345");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ ToMobile: "9825012345" }));
  });

  it.each([
    ["Customer name", "ToName", "Ramesh Patel"],
    ["Company", "ToCompany", "Patel Traders"],
    ["Email", "ToEmail", "ramesh@patel.in"],
    ["Address", "ToAddress", "12 Bopal"],
    ["City", "ToCity", "Ahmedabad"],
    ["Pincode", "ToPincode", "380058"],
    ["Customer GSTIN", "ToGSTIN", "24AAAAA0000A1Z5"],
  ])("patches %s onto the block it belongs to", (label, key, text) => {
    const onChange = showCustomer();
    type(label, text);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ [key]: text }));
  });

  it("picks the place of supply", async () => {
    const onChange = showCustomer();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("place-of-supply-input"));
    await user.click(await screen.findByText("Kerala (32)"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ ToStateCode: "32" }));
  });

  it("empties the place of supply when the picker is cleared", async () => {
    const onChange = showCustomer({ ToStateCode: "32" });
    await userEvent.setup().click(screen.getByTitle("Clear"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ ToStateCode: "" }));
  });
});
