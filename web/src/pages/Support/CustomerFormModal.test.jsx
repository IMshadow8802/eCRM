// web/src/pages/Support/CustomerFormModal.test.jsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import CustomerFormModal from "./CustomerFormModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import { mockCustomerEndpoints, customerRow, refuse, json } from "../../test/supportMocks";

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
      Address: null, City: "Pune", State: null, Pincode: null, GSTIN: null, Remarks: null,
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

  it("strips letters from a typed mobile and rejects it for being short, alongside a malformed email", async () => {
    const cap = mockCustomerEndpoints();
    renderModal();
    const user = userEvent.setup();
    await user.type(screen.getByTestId("customer-Name"), "Acme");
    await user.type(screen.getByTestId("customer-Mobile"), "98abc");
    await user.type(screen.getByTestId("customer-Email"), "not-an-email");
    await user.click(screen.getByTestId("customer-form-submit"));
    // "98abc" is cleaned down to just its digits ("98") as it's typed.
    expect(screen.getByTestId("customer-Mobile")).toHaveValue("98");
    expect(await screen.findByText("Mobile number must be 10 digits")).toBeInTheDocument();
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

  it("posts GSTIN upper-cased", async () => {
    const cap = mockCustomerEndpoints();
    renderModal();
    const user = userEvent.setup();

    await user.type(screen.getByTestId("customer-Name"), "Beta Ltd");
    await user.type(screen.getByTestId("customer-Mobile"), "8880001111");
    await user.type(screen.getByTestId("customer-GSTIN"), "24abcde1234f1z5");
    await user.click(screen.getByTestId("customer-form-submit"));

    await waitFor(() => expect(cap.save).toBeTruthy());
    expect(cap.save.GSTIN).toBe("24ABCDE1234F1Z5");
  });

  it("Cancel closes without posting", async () => {
    const cap = mockCustomerEndpoints();
    const onClose = vi.fn();
    renderModal({ onClose });
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(cap.save).toBeUndefined();
  });

  describe("office field", () => {
    const wideAccess = (reach = "Office") => useAuthStore.setState({
      user: { UserId: 17, BranchId: 1 },
      access: { isAdmin: false, modules: { customers: { view: true, add: true, edit: true, reach } } },
    });
    const branches = (list) => server.use(http.post("*/api/users/fetchBranches", () => json({ branches: list })));
    const TWO = [{ Id: 1, BranchName: "HEAD OFFICE" }, { Id: 2, BranchName: "SOUTH EXTENSION" }];

    it("shows for a wide reach with two offices, and the create payload carries BranchId", async () => {
      wideAccess(); branches(TWO);
      const cap = mockCustomerEndpoints();
      renderModal();
      const user = userEvent.setup();
      expect(await screen.findByTestId("customer-BranchId-input")).toHaveValue("HEAD OFFICE");
      await user.click(screen.getByTestId("customer-BranchId-input"));
      await user.click(await screen.findByRole("option", { name: "SOUTH EXTENSION" }));
      await user.type(screen.getByTestId("customer-Name"), "Gamma");
      await user.type(screen.getByTestId("customer-Email"), "g@example.com");
      await user.click(screen.getByTestId("customer-form-submit"));
      await waitFor(() => expect(cap.save).toBeTruthy());
      expect(cap.save.BranchId).toBe(2);
    });

    it("is hidden with one office, and for an Own reach", async () => {
      wideAccess();
      let served = 0;
      server.use(http.post("*/api/users/fetchBranches", () => { served += 1; return json({ branches: [TWO[0]] }); }));
      const { unmount } = renderModal();
      await waitFor(() => expect(served).toBe(1));
      await screen.findByTestId("customer-Name");
      await waitFor(() => expect(screen.queryByTestId("customer-BranchId-input")).toBeNull());
      unmount();
      // Own reach never asks for offices at all.
      wideAccess("Own");
      let asked = false;
      server.use(http.post("*/api/users/fetchBranches", () => { asked = true; return json({ branches: TWO }); }));
      renderModal();
      await screen.findByTestId("customer-Name");
      expect(asked).toBe(false);
      expect(screen.queryByTestId("customer-BranchId-input")).toBeNull();
    });

    it("on edit sends BranchId only when the office changed", async () => {
      wideAccess(); branches(TWO);
      const cap = mockCustomerEndpoints();
      renderModal({ customer: customerRow({ BranchId: 1 }) });
      const user = userEvent.setup();
      await screen.findByTestId("customer-BranchId-input");
      await user.click(screen.getByTestId("customer-form-submit"));
      await waitFor(() => expect(cap.save).toBeTruthy());
      expect(cap.save).not.toHaveProperty("BranchId");
    });

    // M2: a closed office is no place to file a new customer, but an edit keeps the current one.
    const WITH_CLOSED = [{ Id: 1, BranchName: "HEAD OFFICE", IsActive: true },
      { Id: 2, BranchName: "SOUTH EXTENSION", IsActive: true }, { Id: 3, BranchName: "OLD TOWN", IsActive: false }];

    it("lists only active offices", async () => {
      wideAccess(); branches(WITH_CLOSED);
      renderModal();
      const user = userEvent.setup();
      await user.click(await screen.findByTestId("customer-BranchId-input"));
      expect(await screen.findByRole("option", { name: "SOUTH EXTENSION" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "OLD TOWN" })).toBeNull();
    });

    it("on edit keeps the customer's current office even when it is closed", async () => {
      wideAccess(); branches(WITH_CLOSED);
      renderModal({ customer: customerRow({ BranchId: 3 }) });
      expect(await screen.findByTestId("customer-BranchId-input")).toHaveValue("OLD TOWN");
    });

    it("on edit sends the new office when it was moved", async () => {
      wideAccess(); branches(TWO);
      const cap = mockCustomerEndpoints();
      renderModal({ customer: customerRow({ BranchId: 1 }) });
      const user = userEvent.setup();
      await user.click(await screen.findByTestId("customer-BranchId-input"));
      await user.click(await screen.findByRole("option", { name: "SOUTH EXTENSION" }));
      await user.click(screen.getByTestId("customer-form-submit"));
      await waitFor(() => expect(cap.save).toBeTruthy());
      expect(cap.save.BranchId).toBe(2);
    });
  });
});
