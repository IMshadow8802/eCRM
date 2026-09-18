// web/src/pages/Support/CustomerPicker.test.jsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CustomerPicker from "./CustomerPicker";
import useAuthStore from "../../stores/useAuthStore";
import renderWithProviders from "../../test/renderWithProviders";
import { mockCustomerEndpoints, customerRow } from "../../test/supportMocks";

const CUSTOMERS = [customerRow(), customerRow({ Id: 4, Name: "Zenith Traders", Mobile: null, Email: "zen@example.com" })];

describe("CustomerPicker", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM" });
  });

  it("lists customers as 'Name · Mobile' (email when no mobile) and hands the picked row back", async () => {
    const cap = mockCustomerEndpoints({}, { customers: CUSTOMERS });
    const onChange = vi.fn();
    renderWithProviders(<CustomerPicker value={null} onChange={onChange} />, { router: false });
    const user = userEvent.setup();

    await user.click(screen.getByTestId("customer-picker-input"));
    expect(await screen.findByRole("option", { name: "Acme Corp · 9990001111" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Zenith Traders · zen@example.com" })).toBeInTheDocument();
    // Mount fetch: no term yet, first page of 20.
    expect(cap.list).toEqual({ SearchTerm: null, PageSize: 20 });

    await user.click(screen.getByRole("option", { name: "Acme Corp · 9990001111" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ Id: 3, Name: "Acme Corp", Mobile: "9990001111" }));
  });

  it("debounces typing into one search request and never filters client-side", async () => {
    const cap = mockCustomerEndpoints({}, { customers: CUSTOMERS });
    renderWithProviders(<CustomerPicker value={null} onChange={vi.fn()} />, { router: false });
    const user = userEvent.setup();

    await user.type(screen.getByTestId("customer-picker-input"), "zen");
    await waitFor(() => expect(cap.list).toEqual({ SearchTerm: "zen", PageSize: 20 }));
    expect(await screen.findByRole("option", { name: "Zenith Traders · zen@example.com" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Acme Corp · 9990001111" })).toBeNull();
  });

  // Spec §6 regression: create inline and select the new id.
  it("'+ New customer' opens the form and selects what it saves", async () => {
    const cap = mockCustomerEndpoints({}, { customers: CUSTOMERS });
    const onChange = vi.fn();
    renderWithProviders(<CustomerPicker value={null} onChange={onChange} />, { router: false });
    const user = userEvent.setup();

    await user.click(screen.getByTestId("customer-picker-input"));
    await user.click(await screen.findByRole("option", { name: "+ New customer" }));
    // The sentinel is never a value.
    expect(onChange).not.toHaveBeenCalled();

    const modal = await screen.findByTestId("customer-form-modal");
    expect(modal).toBeInTheDocument();
    await user.type(screen.getByTestId("customer-Name"), "Beta Ltd");
    await user.type(screen.getByTestId("customer-Mobile"), "8880001111");
    await user.click(screen.getByTestId("customer-form-submit"));

    await waitFor(() => expect(cap.save).toMatchObject({ Id: 0, Name: "Beta Ltd" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ Id: 44, Name: "Beta Ltd", Mobile: "8880001111" })));
    await waitFor(() => expect(screen.queryByTestId("customer-form-modal")).not.toBeInTheDocument());
  });

  it("shows the given value even when the search did not return it, and clears to null", async () => {
    mockCustomerEndpoints({}, { customers: CUSTOMERS });
    const onChange = vi.fn();
    renderWithProviders(
      <CustomerPicker value={{ Id: 99, Name: "Offline Shop", Mobile: "7770001111" }} onChange={onChange} error="Pick a customer" />,
      { router: false },
    );
    expect(screen.getByTestId("customer-picker-input")).toHaveValue("Offline Shop · 7770001111");
    expect(screen.getByText("Pick a customer")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByTitle("Clear"));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
