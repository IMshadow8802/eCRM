import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";

import renderWithProviders from "../../test/renderWithProviders";
import { buildTheme } from "../../theme";

// Products.jsx's job is to wire the right config into useServerTable and to
// post the right body — so the composition hook is mocked and the wiring is
// what the assertions read.
vi.mock("../../hooks/useServerTable", () => ({
  __esModule: true,
  default: vi.fn(() => ({
    table: { __options: {} },
    data: [],
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    totalRecords: 0,
  })),
}));

// Category options come from tblLookup Kind='product_category'.
vi.mock("../../hooks/useLookups", () => {
  const useLookups = vi.fn(() => ({ lookups: [{ Id: 12, Value: "Electronics" }] }));
  return { __esModule: true, useLookups, default: useLookups };
});

const confirmDelete = vi.fn();
vi.mock("../../hooks", () => ({
  useConfirmation: () => ({
    isOpen: false,
    confirmDelete,
    confirmationState: {},
    hideConfirmation: vi.fn(),
    handleConfirm: vi.fn(),
    isLoading: false,
  }),
}));

// The page writes through useApiMutation, which posts on the one shared
// apiClient — stubbing the client keeps the endpoint assertions readable.
const post = vi.fn();
vi.mock("../../utils/axiosConfig", () => ({
  __esModule: true,
  apiClient: { post: (...args) => post(...args) },
}));

// Don't render the real MRT shell in jsdom.
vi.mock("material-react-table", () => ({
  MaterialReactTable: ({ table }) => (
    <div data-testid="mrt-root" data-row-count={table?.__options?.rowCount ?? 0} />
  ),
}));

// One spy for both toast routes: the page toasts through useSnackbar, while
// useApiMutation imports enqueueSnackbar off the module directly.
const enqueueSnackbar = vi.fn();
vi.mock("notistack", async () => {
  const actual = await vi.importActual("notistack");
  return {
    ...actual,
    enqueueSnackbar: (...args) => enqueueSnackbar(...args),
    closeSnackbar: vi.fn(),
    useSnackbar: () => ({ enqueueSnackbar }),
  };
});

import Products from "./Products";
import useServerTable from "../../hooks/useServerTable";

const renderPage = () => renderWithProviders(<Products />);
const lastCfg = () => useServerTable.mock.calls.at(-1)[0];
const cellOf = (key) => lastCfg().columns.find((c) => c.accessorKey === key).Cell;
const cell = (value) => ({ cell: { getValue: () => value } });

const openRowActions = (row) =>
  render(
    <ThemeProvider theme={buildTheme("light")}>{lastCfg().renderRowActions({ row })}</ThemeProvider>
  );

describe("Products page", () => {
  beforeEach(() => {
    useServerTable.mockClear();
    post.mockReset();
    post.mockResolvedValue({ data: { success: true, data: { Id: 1 } } });
    confirmDelete.mockReset();
    enqueueSnackbar.mockReset();
  });

  it("wires the table to fetchProducts with IsActive:null (admin sees inactive too)", () => {
    renderPage();
    const cfg = lastCfg();
    expect(cfg.endpoint).toBe("/api/products/fetchProducts");
    expect(cfg.dataKey).toBe("products");
    expect(cfg.extraParams).toEqual({ IsActive: null });
    expect(cfg.queryKey).toBe("products");
    expect(cfg.getRowId({ Id: 7 })).toBe(7);
  });

  it("creates a product with numeric price and margin", async () => {
    post.mockResolvedValue({ data: { success: true, data: { Id: 3 } } });
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("new-product-btn"));
    await user.type(screen.getByLabelText(/^Name/), "TV 43in");
    await user.type(screen.getByLabelText(/Code/), "TV43");
    await user.click(screen.getByLabelText(/Category/));
    await user.click(await screen.findByRole("option", { name: "Electronics" }));
    await user.type(screen.getByLabelText(/Unit price/), "45000");
    await user.type(screen.getByLabelText(/Margin/), "10");
    await user.click(screen.getByRole("button", { name: "Create Product" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/products/saveProduct", {
        Id: 0,
        Name: "TV 43in",
        Code: "TV43",
        CategoryId: 12,
        UnitPrice: 45000,
        MarginPct: 10,
        IsActive: true,
      })
    );
  });

  it("rejects a margin over 100 before posting", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("new-product-btn"));
    await user.type(screen.getByLabelText(/^Name/), "X");
    await user.type(screen.getByLabelText(/Margin/), "150");
    await user.click(screen.getByRole("button", { name: "Create Product" }));
    expect(screen.getByText(/between 0 and 100/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("requires a name and refuses a negative price", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("new-product-btn"));
    await user.type(screen.getByLabelText(/Unit price/), "-5");
    await user.click(screen.getByRole("button", { name: "Create Product" }));
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(screen.getByText(/cannot be negative/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();

    // Typing into a field clears its own error, so the form isn't stuck red.
    await user.type(screen.getByLabelText(/^Name/), "Fan");
    expect(screen.queryByText("Name is required")).toBeNull();
  });

  it("edits a product: prefills the row, keeps its Id, and can deactivate it", async () => {
    renderPage();
    openRowActions({
      original: {
        Id: 9,
        Name: "AC 1.5T",
        Code: "AC15",
        CategoryId: 12,
        UnitPrice: 32000,
        MarginPct: 12,
        IsActive: true,
      },
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /edit product/i }));

    expect(await screen.findByLabelText(/^Name/)).toHaveValue("AC 1.5T");
    expect(screen.getByLabelText(/Code/)).toHaveValue("AC15");
    expect(screen.getByLabelText(/Unit price/)).toHaveValue("32000");

    // The input itself is visually hidden (pointer-events: none); its label is
    // what a user clicks.
    await user.click(screen.getByText("Active"));
    await user.click(screen.getByRole("button", { name: "Update Product" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/products/saveProduct", {
        Id: 9,
        Name: "AC 1.5T",
        Code: "AC15",
        CategoryId: 12,
        UnitPrice: 32000,
        MarginPct: 12,
        IsActive: false,
      })
    );
  });

  it("sends nulls for the optional fields left blank", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("new-product-btn"));
    await user.type(screen.getByLabelText(/^Name/), "Bare");
    await user.click(screen.getByRole("button", { name: "Create Product" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/products/saveProduct", {
        Id: 0,
        Name: "Bare",
        Code: null,
        CategoryId: null,
        UnitPrice: null,
        MarginPct: null,
        IsActive: true,
      })
    );
  });

  it("surfaces a refusal from the API instead of closing the modal", async () => {
    post.mockResolvedValue({ data: { success: false, message: "Only admins may add products" } });
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("new-product-btn"));
    await user.type(screen.getByLabelText(/^Name/), "TV");
    await user.click(screen.getByRole("button", { name: "Create Product" }));
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith("Only admins may add products", {
        variant: "error",
      })
    );
    expect(screen.getByRole("button", { name: "Create Product" })).toBeInTheDocument();
  });

  it("falls back to a generic message when the save request itself fails", async () => {
    post.mockRejectedValue(Object.assign(new Error("Network Error"), { isAxiosError: true }));
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("new-product-btn"));
    await user.type(screen.getByLabelText(/^Name/), "TV");
    await user.click(screen.getByRole("button", { name: "Create Product" }));
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith("Failed to save product", { variant: "error" })
    );
  });

  it("closes the modal on cancel", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("new-product-btn"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByLabelText(/^Name/)).toBeNull());
  });
});

describe("Products delete flow", () => {
  const row = { original: { Id: 4, Name: "TV 43in" } };

  const clickDelete = async () => {
    renderPage();
    openRowActions(row);
    await userEvent.setup().click(screen.getByRole("button", { name: /delete product/i }));
    return confirmDelete.mock.calls.at(-1)[0];
  };

  beforeEach(() => {
    useServerTable.mockClear();
    post.mockReset();
    post.mockResolvedValue({ data: { success: true } });
    confirmDelete.mockReset();
    enqueueSnackbar.mockReset();
  });

  it("asks for confirmation naming the product before deleting", async () => {
    const opts = await clickDelete();
    expect(opts.title).toBe("Delete Product");
    expect(opts.message).toContain("TV 43in");
    expect(post).not.toHaveBeenCalled();
  });

  it("posts { Id } on confirm", async () => {
    const opts = await clickDelete();
    await opts.onConfirm();
    expect(post).toHaveBeenCalledWith("/api/products/deleteProduct", { Id: 4 });
  });

  it("surfaces a refusal from the delete API", async () => {
    post.mockResolvedValueOnce({ data: { success: false, message: "Product is on 3 leads" } });
    const opts = await clickDelete();
    await expect(opts.onConfirm()).rejects.toThrow("Product is on 3 leads");
    expect(enqueueSnackbar).toHaveBeenCalledWith("Product is on 3 leads", { variant: "error" });
  });

  it("falls back to a generic message when the delete request fails", async () => {
    post.mockRejectedValueOnce(Object.assign(new Error("Network Error"), { isAxiosError: true }));
    const opts = await clickDelete();
    await expect(opts.onConfirm()).rejects.toThrow();
    expect(enqueueSnackbar).toHaveBeenCalledWith("Failed to delete product", { variant: "error" });
  });
});

describe("Products columns", () => {
  beforeEach(() => useServerTable.mockClear());

  it("lists the expected columns", () => {
    renderPage();
    expect(lastCfg().columns.map((c) => c.accessorKey)).toEqual([
      "Name",
      "Code",
      "CategoryName",
      "UnitPrice",
      "MarginPct",
      "IsActive",
    ]);
  });

  it("renders the derived cells and their empty fallbacks", () => {
    renderPage();
    expect(cellOf("Code")(cell("TV43"))).toBe("TV43");
    expect(cellOf("Code")(cell(null))).toBe("—");
    expect(cellOf("CategoryName")(cell("Electronics"))).toBe("Electronics");
    expect(cellOf("CategoryName")(cell(null))).toBe("—");
    expect(cellOf("UnitPrice")(cell(45000))).toContain("45,000");
    expect(cellOf("UnitPrice")(cell(null))).toBe("—");
    expect(cellOf("MarginPct")(cell(10))).toBe("10%");
    expect(cellOf("MarginPct")(cell(null))).toBe("—");

    // The status cell is the design-system Chip, which reads theme.tokens —
    // a bare render() has no theme, so wrap it like the row-actions helper does.
    const themed = (node) => render(<ThemeProvider theme={buildTheme("light")}>{node}</ThemeProvider>);
    themed(cellOf("IsActive")(cell(true)));
    expect(screen.getByText("Active")).toBeInTheDocument();
    themed(cellOf("IsActive")(cell(false)));
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });
});
