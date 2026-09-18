// web/src/pages/Support/CustomerFormModal.test.jsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import CustomerFormModal from "./CustomerFormModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import { mockCustomerEndpoints, customerRow, refuse } from "../../test/supportMocks";

const renderModal = (props = {}) =>
  renderWithProviders(<CustomerFormModal open onClose={vi.fn()} onSaved={vi.fn()} {...props} />, { router: false });

describe("CustomerFormModal", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM" });
  });

  it("creates a customer: trims strings, nulls blanks, hands the saved row back", async () => {
    const cap = mockCustomerEndpoints();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderModal({ onSaved, onClose });
    const user = userEvent.setup();

    await user.type(screen.getByTestId("customer-Name"), "  Beta Ltd ");
    await user.type(screen.getByTestId("customer-ContactPerson"), "Rohan");
    await user.type(screen.getByTestId("customer-Mobile"), "8880001111");
    await user.type(screen.getByTestId("customer-City"), "Pune");
    await user.click(screen.getByTestId("customer-form-submit"));

    await waitFor(() => expect(cap.save).toBeTruthy());
    expect(cap.save).toEqual({
      Id: 0, Name: "Beta Ltd", ContactPerson: "Rohan", Mobile: "8880001111", AltMobile: null, Email: null,
      Address: null, City: "Pune", State: null, Pincode: null, Remarks: null,
    });
    // The mock answers Id 44 — the picker needs the row with its new id, not a refetch.
    expect(onSaved).toHaveBeenCalledWith({ ...cap.save, Id: 44 });
    expect(onClose).toHaveBeenCalled();
  });

  it("refuses without a name, then without a mobile or an email", async () => {
    const cap = mockCustomerEndpoints();
    renderModal();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("customer-form-submit"));
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(cap.save).toBeUndefined();

    await user.type(screen.getByTestId("customer-Name"), "Nameless Shop");
    await user.click(screen.getByTestId("customer-form-submit"));
    expect(await screen.findByText("A mobile number or an email is required")).toBeInTheDocument();
    expect(cap.save).toBeUndefined();

    // Email alone satisfies the rule.
    await user.type(screen.getByTestId("customer-Email"), "shop@example.com");
    await user.click(screen.getByTestId("customer-form-submit"));
    await waitFor(() => expect(cap.save).toMatchObject({ Name: "Nameless Shop", Mobile: null, Email: "shop@example.com" }));
  });

  it("rejects letters in a mobile and a malformed email", async () => {
    const cap = mockCustomerEndpoints();
    renderModal();
    const user = userEvent.setup();
    await user.type(screen.getByTestId("customer-Name"), "Acme");
    await user.type(screen.getByTestId("customer-Mobile"), "98abc");
    await user.type(screen.getByTestId("customer-Email"), "not-an-email");
    await user.click(screen.getByTestId("customer-form-submit"));
    expect(await screen.findByText("Digits only")).toBeInTheDocument();
    expect(screen.getByText("Invalid email")).toBeInTheDocument();
    expect(cap.save).toBeUndefined();
  });

  it("edit mode prefills every field and posts the customer's Id", async () => {
    const cap = mockCustomerEndpoints();
    const onSaved = vi.fn();
    renderModal({ customer: customerRow({ Remarks: "Prefers WhatsApp" }), onSaved });
    const user = userEvent.setup();

    expect(screen.getByText("Edit Customer")).toBeInTheDocument();
    expect(screen.getByTestId("customer-Name")).toHaveValue("Acme Corp");
    expect(screen.getByTestId("customer-ContactPerson")).toHaveValue("Gurpreet");
    expect(screen.getByTestId("customer-Mobile")).toHaveValue("9990001111");
    expect(screen.getByTestId("customer-Email")).toHaveValue("acme@example.com");
    expect(screen.getByTestId("customer-Address")).toHaveValue("12 MG Road");
    expect(screen.getByTestId("customer-City")).toHaveValue("Pune");
    expect(screen.getByTestId("customer-State")).toHaveValue("MH");
    expect(screen.getByTestId("customer-Pincode")).toHaveValue("411001");
    expect(screen.getByTestId("customer-Remarks")).toHaveValue("Prefers WhatsApp");

    await user.clear(screen.getByTestId("customer-City"));
    await user.type(screen.getByTestId("customer-City"), "Mumbai");
    await user.click(screen.getByTestId("customer-form-submit"));

    await waitFor(() => expect(cap.save).toBeTruthy());
    expect(cap.save).toMatchObject({ Id: 3, Name: "Acme Corp", Mobile: "9990001111", City: "Mumbai", Remarks: "Prefers WhatsApp" });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ Id: 3, City: "Mumbai" }));
  });

  it("surfaces the server's 409 and keeps the modal open", async () => {
    mockCustomerEndpoints();
    server.use(http.post("*/api/customers/saveCustomer", () => refuse("A customer with this mobile already exists", 409)));
    const onClose = vi.fn();
    renderModal({ onClose });
    const user = userEvent.setup();
    await user.type(screen.getByTestId("customer-Name"), "Acme Two");
    await user.type(screen.getByTestId("customer-Mobile"), "9990001111");
    await user.click(screen.getByTestId("customer-form-submit"));
    expect(await screen.findByText("A customer with this mobile already exists")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("customer-form-modal")).toBeInTheDocument();
  });

  it("Cancel closes without posting", async () => {
    const cap = mockCustomerEndpoints();
    const onClose = vi.fn();
    renderModal({ onClose });
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(cap.save).toBeUndefined();
  });
});
