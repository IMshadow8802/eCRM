import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import renderWithProviders from "../../test/renderWithProviders";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock the composition hook. Users.jsx's job is to wire the right config
// into useServerTable; testing that wiring is the point.
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

vi.mock("../../hooks/useApiQuery", () => ({
  useApiQuery: vi.fn(() => ({ data: { userGroups: [] } })),
}));

// Users.jsx writes through api/masterQueries, which posts on the one shared
// apiClient — so the client is what we stub, and the endpoint assertions below
// still read as "this page hits this URL".
const post = vi.fn();
vi.mock("../../utils/axiosConfig", () => ({
  __esModule: true,
  apiClient: { post: (...args) => post(...args) },
}));

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

// Don't try to render the real MRT shell in jsdom.
vi.mock("material-react-table", () => ({
  MaterialReactTable: ({ table }) => (
    <div data-testid="mrt-root" data-row-count={table?.__options?.rowCount ?? 0} />
  ),
}));

const enqueueSnackbar = vi.fn();
vi.mock("notistack", async () => {
  const actual = await vi.importActual("notistack");
  return { ...actual, useSnackbar: () => ({ enqueueSnackbar }) };
});

// Stand-in for the form: we assert on the props Users hands it, not its render.
vi.mock("./components/UserForm", () => ({
  __esModule: true,
  default: vi.fn(() => null),
}));

import Users from "./Users";
import useServerTable from "../../hooks/useServerTable";
import { useApiQuery } from "../../hooks/useApiQuery";
import UserForm from "./components/UserForm";

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Users />
      </MemoryRouter>
    </QueryClientProvider>
  );

describe("Users page", () => {
  beforeEach(() => {
    useServerTable.mockClear();
    useApiQuery.mockClear();
    UserForm.mockClear();
    post.mockReset();
    post.mockResolvedValue({ data: { success: true } });
    confirmDelete.mockReset();
    enqueueSnackbar.mockReset();
  });

  it("renders the page header", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /users/i })).toBeInTheDocument();
  });

  it("wires useServerTable to /api/users/fetchUsers with dataKey=users", () => {
    renderPage();
    expect(useServerTable).toHaveBeenCalled();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.endpoint).toBe("/api/users/fetchUsers");
    expect(cfg.dataKey).toBe("users");
    expect(cfg.queryKey).toBe("users");
  });

  it("defines the expected columns in the expected order", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const headers = cfg.columns.map((c) => c.accessorKey);
    expect(headers).toEqual([
      "Username",
      "FullName",
      "Email",
      "JobTitle",
      "GroupName",
      "ReportsToName",
      "HourlyRate",
      "IsActive",
      "IsAdmin",
      "CreatedDate",
    ]);
  });

  // Reports To is a plain read column fed by fetchUsers' ReportsToName (a
  // server-side join) — nothing to pick here, just render what came back.
  it("renders the Reports To cell, falling back when the user has no manager", () => {
    renderPage();
    const cols = useServerTable.mock.calls.at(-1)[0].columns;
    const cell = (value) => ({ cell: { getValue: () => value } });
    const reportsToCell = cols.find((c) => c.accessorKey === "ReportsToName").Cell;

    expect(reportsToCell(cell("Meera Manager"))).toBe("Meera Manager");
    expect(reportsToCell(cell(null))).toBe("—");
  });

  it("passes a bulk PageSize when populating the user-groups dropdown", () => {
    renderPage();
    const call = useApiQuery.mock.calls.find(
      ([cfg]) => cfg.endpoint === "/api/user-groups/fetchUserGroups"
    );
    expect(call).toBeTruthy();
    expect(call[0].params).toMatchObject({ PageSize: 1000, SearchTerm: null });
  });

  // REGRESSION: handleEdit rebuilt the row field-by-field and left Mobile out,
  // so the form rendered it blank, sent nothing, and sp_SaveUser wrote NULL —
  // silently wiping the number. Mobile is a login identifier (username OR email
  // OR mobile), so this locked users out of one of their sign-in routes.
  it("carries Mobile into the edit form so an edit cannot wipe it", async () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];

    const row = {
      original: {
        Id: 11,
        Username: "Vikas",
        FullName: "Vikas Jaiswal",
        Email: "vikas@jaiswal.com",
        Mobile: "7972627064",
        JobTitle: "Engineer",
        HourlyRate: 12.5,
        GroupId: 8,
        IsActive: true,
        IsAdmin: false,
        AllowDay: 0,
        UserIp: "",
      },
    };

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>{cfg.renderRowActions({ row })}</MemoryRouter>
      </QueryClientProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: /edit/i }));

    expect(UserForm).toHaveBeenCalled();
    const props = UserForm.mock.calls.at(-1)[0];
    expect(props.editingUser).toMatchObject({
      Id: 11,
      Username: "Vikas",
      Mobile: "7972627064",
    });
  });

  // ReportsTo drives the manager picker's prefill on edit — leaving it out of
  // handleEdit would silently reopen every edit at "no manager".
  it("carries ReportsTo into the edit form so the manager picker prefills", async () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];

    const row = {
      original: {
        Id: 11,
        Username: "Vikas",
        FullName: "Vikas Jaiswal",
        Email: "vikas@jaiswal.com",
        Mobile: "7972627064",
        JobTitle: "Engineer",
        HourlyRate: 12.5,
        GroupId: 8,
        ReportsTo: 4,
        IsActive: true,
        IsAdmin: false,
        AllowDay: 0,
        UserIp: "",
      },
    };

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>{cfg.renderRowActions({ row })}</MemoryRouter>
      </QueryClientProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: /edit/i }));

    expect(UserForm).toHaveBeenCalled();
    expect(UserForm.mock.calls.at(-1)[0].editingUser).toMatchObject({ ReportsTo: 4 });
  });

  it("defaults ReportsTo to null when the row has no manager", async () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];

    const row = {
      original: {
        Id: 12,
        Username: "NoManager",
        FullName: "No Manager",
        GroupId: 8,
        ReportsTo: null,
        IsActive: true,
        IsAdmin: false,
      },
    };

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>{cfg.renderRowActions({ row })}</MemoryRouter>
      </QueryClientProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: /edit/i }));

    expect(UserForm.mock.calls.at(-1)[0].editingUser).toMatchObject({ ReportsTo: null });
  });

  it("renders the derived cells (rate, status, admin, date)", () => {
    renderPage();
    const cols = useServerTable.mock.calls.at(-1)[0].columns;
    const cellOf = (key) => cols.find((c) => c.accessorKey === key).Cell;
    const cell = (value) => ({ cell: { getValue: () => value } });

    expect(cellOf("HourlyRate")(cell(12.5))).toBe("₹12.5");
    expect(cellOf("HourlyRate")(cell(null))).toBe("₹0");
    expect(cellOf("CreatedDate")(cell("2026-07-29T12:05:25.813Z"))).toBe("29-07-2026");
    expect(cellOf("CreatedDate")(cell(null))).toBe("");

    render(<>{cellOf("IsActive")(cell(true))}</>);
    expect(screen.getByText("Active")).toBeInTheDocument();
    render(<>{cellOf("IsActive")(cell(false))}</>);
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    render(<>{cellOf("IsAdmin")(cell(true))}</>);
    expect(screen.getByText("Yes")).toBeInTheDocument();
    render(<>{cellOf("IsAdmin")(cell(false))}</>);
    expect(screen.getByText("No")).toBeInTheDocument();
  });
});

describe("Users delete flow", () => {
  const row = { original: { Id: 11, Username: "Vikas", FullName: "Vikas Jaiswal" } };

  const clickDelete = async () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>{cfg.renderRowActions({ row })}</MemoryRouter>
      </QueryClientProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: /delete/i }));
    return confirmDelete.mock.calls.at(-1)[0];
  };

  it("asks for confirmation naming the user before deleting", async () => {
    const opts = await clickDelete();
    expect(opts.title).toBe("Delete User");
    expect(opts.message).toContain("Vikas Jaiswal");
    expect(post).not.toHaveBeenCalled(); // nothing until confirmed
  });

  it("posts the delete and refreshes on confirm", async () => {
    const opts = await clickDelete();
    await opts.onConfirm();
    expect(post).toHaveBeenCalledWith("/api/users/deleteUser", { Id: 11 });
    expect(enqueueSnackbar).toHaveBeenCalledWith(
      "User deleted successfully!",
      { variant: "success" }
    );
  });

  it("surfaces a refusal from the API", async () => {
    post.mockResolvedValueOnce({
      data: { success: false, message: "Cannot delete yourself" },
    });
    const opts = await clickDelete();
    await opts.onConfirm();
    expect(enqueueSnackbar).toHaveBeenCalledWith("Cannot delete yourself", {
      variant: "error",
    });
  });

  it("rethrows a network failure so the dialog stays open", async () => {
    post.mockRejectedValueOnce(new Error("offline"));
    const opts = await clickDelete();
    await expect(opts.onConfirm()).rejects.toThrow("offline");
    expect(enqueueSnackbar).toHaveBeenCalledWith("Failed to delete user!", {
      variant: "error",
    });
  });
});

describe("Users create flow", () => {
  it("opens the form with no editingUser when Create User is clicked", async () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];

    // Initially closed.
    expect(UserForm.mock.calls.at(-1)[0].open).toBe(false);

    renderWithProviders(cfg.renderTopToolbarCustomActions());
    await userEvent.click(screen.getByRole("button", { name: /create user/i }));

    const props = UserForm.mock.calls.at(-1)[0];
    expect(props.open).toBe(true);
    expect(props.editingUser).toBeNull();
  });

  it("closing the form clears the editing user", async () => {
    renderPage();
    UserForm.mock.calls.at(-1)[0].onClose();
    const props = UserForm.mock.calls.at(-1)[0];
    expect(props.open).toBe(false);
    expect(props.editingUser).toBeNull();
  });

  it("surfaces a fetch failure", () => {
    useServerTable.mockReturnValueOnce({
      table: { __options: {} },
      data: [],
      isLoading: false,
      isFetching: false,
      error: new Error("boom"),
      refetch: vi.fn(),
      totalRecords: 0,
    });
    renderPage();
    expect(enqueueSnackbar).toHaveBeenCalledWith("Failed to load users", {
      variant: "error",
    });
  });
});
