import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@mui/material/styles";

import { buildTheme } from "../../theme";

const FIXTURE_USERS = [
  { Id: 1, Username: "alice", FullName: "Alice" },
  { Id: 2, Username: "bob", FullName: "Bob" },
];

const FIXTURE_TICKETS = [
  {
    Id: 101,
    TicketNo: "TKT-001",
    CustomerName: "Acme Corp",
    Contact: "9990001111",
    Priority: 7,
    CategoryId: 5,
    StageId: 3,
    AssignedTo: 2,
    IsBreached: true,
  },
];

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../../hooks/useServerTable", () => ({
  __esModule: true,
  default: vi.fn(() => ({
    table: { __options: { data: FIXTURE_TICKETS } },
    data: FIXTURE_TICKETS,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    totalRecords: FIXTURE_TICKETS.length,
  })),
}));

vi.mock("../../hooks", () => ({
  useUsers: vi.fn(() => ({ data: { users: FIXTURE_USERS } })),
}));

vi.mock("../../hooks/useApiQuery", () => ({
  useApiQuery: vi.fn((cfg) => {
    if (cfg?.endpoint === "/api/config/fetchPipelines") {
      return {
        data: {
          pipelines: [{ Id: 9, Name: "Support", IsDefault: true }],
          stages: [
            { Id: 3, PipelineId: 9, Name: "Open" },
            { Id: 4, PipelineId: 9, Name: "Resolved" },
          ],
        },
      };
    }
    // fetchLookups: return by Kind
    if (cfg?.params?.Kind === "priority") {
      return {
        data: {
          lookups: [
            { Id: 7, Value: "High" },
            { Id: 8, Value: "Low" },
          ],
        },
      };
    }
    // ticket_category
    return {
      data: {
        lookups: [
          { Id: 5, Value: "Billing" },
          { Id: 6, Value: "Technical" },
        ],
      },
    };
  }),
}));

vi.mock("material-react-table", () => ({
  MaterialReactTable: ({ table }) => (
    <div data-testid="mrt-root">
      {(table?.__options?.data ?? []).map((row) => (
        <div key={row.Id} data-testid={`ticket-row-${row.Id}`}>
          {row.TicketNo}
        </div>
      ))}
    </div>
  ),
}));

import Tickets from "./Tickets";
import useServerTable from "../../hooks/useServerTable";
import { useUsers } from "../../hooks";
import { useApiQuery } from "../../hooks/useApiQuery";

const renderPage = () =>
  render(
    <ThemeProvider theme={buildTheme("light")}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Tickets />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );

describe("Support Tickets page", () => {
  beforeEach(() => {
    useServerTable.mockClear();
    useUsers.mockClear();
    useApiQuery.mockClear();
    mockNavigate.mockClear();
  });

  it("wires useServerTable to /api/tickets/fetchTickets with dataKey=tickets", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.endpoint).toBe("/api/tickets/fetchTickets");
    expect(cfg.dataKey).toBe("tickets");
  });

  it("defines the core ticket columns in order", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const keys = cfg.columns.map((c) => c.accessorKey);
    expect(keys).toEqual([
      "TicketNo",
      "CustomerName",
      "Contact",
      "Priority",
      "CategoryId",
      "StageId",
      "AssignedTo",
      "IsBreached",
    ]);
  });

  it("renders rows from the server table", () => {
    renderPage();
    expect(screen.getByTestId("ticket-row-101")).toBeInTheDocument();
    expect(screen.getByText("TKT-001")).toBeInTheDocument();
  });

  it("resolves the Priority column to its name and falls back to a dash", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const col = cfg.columns.find((c) => c.accessorKey === "Priority");
    expect(col.Cell({ cell: { getValue: () => 7 } })).toBe("High");
    expect(col.Cell({ cell: { getValue: () => null } })).toBe("—");
  });

  it("resolves the Category column to its name and falls back to a dash", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const col = cfg.columns.find((c) => c.accessorKey === "CategoryId");
    expect(col.Cell({ cell: { getValue: () => 5 } })).toBe("Billing");
    expect(col.Cell({ cell: { getValue: () => null } })).toBe("—");
  });

  it("resolves the Stage column to its name and falls back to a dash", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const col = cfg.columns.find((c) => c.accessorKey === "StageId");
    expect(col.Cell({ cell: { getValue: () => 3 } })).toBe("Open");
    expect(col.Cell({ cell: { getValue: () => null } })).toBe("—");
  });

  it("resolves the Assignee column against the bulk-loaded users list", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const col = cfg.columns.find((c) => c.accessorKey === "AssignedTo");
    expect(col.Cell({ cell: { getValue: () => 2 } })).toBe("Bob");
    expect(col.Cell({ cell: { getValue: () => null } })).toBe("—");
  });

  it("renders a Breached chip when IsBreached is truthy and a dash otherwise", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const col = cfg.columns.find((c) => c.accessorKey === "IsBreached");
    const { getByText } = render(col.Cell({ cell: { getValue: () => true } }));
    expect(getByText("Breached")).toBeInTheDocument();
    expect(col.Cell({ cell: { getValue: () => false } })).toBe("—");
  });

  it("bulk-loads users, priority + category lookups, and ticket pipelines", () => {
    renderPage();
    expect(useUsers).toHaveBeenCalledWith({ PageSize: 1000 });
    const lookupCalls = useApiQuery.mock.calls
      .map(([cfg]) => cfg)
      .filter((cfg) => cfg.endpoint === "/api/config/fetchLookups")
      .map((cfg) => cfg.params);
    expect(lookupCalls).toEqual(
      expect.arrayContaining([{ Kind: "priority" }, { Kind: "ticket_category" }])
    );
    const pipelineCall = useApiQuery.mock.calls.find(
      ([cfg]) => cfg.endpoint === "/api/config/fetchPipelines"
    );
    expect(pipelineCall[0].params).toEqual({ Entity: "ticket" });
  });

  // The filters are Combobox (Autocomplete) — open, then pick an option.
  const pickOption = async (testId, optionName) => {
    const user = userEvent.setup();
    await user.click(screen.getByTestId(`${testId}-input`));
    await user.click(await screen.findByRole("option", { name: optionName }));
  };

  it("forwards StageId when the stage filter changes", async () => {
    renderPage();
    await pickOption("filter-stage", "Open");
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.extraParams).toEqual({
      StageId: 3,
      Priority: null,
      CategoryId: null,
      AssignedTo: null,
      BreachedOnly: 0,
    });
  });

  it("forwards Priority when the priority filter changes", async () => {
    renderPage();
    await pickOption("filter-priority", "High");
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.extraParams).toEqual({
      StageId: null,
      Priority: 7,
      CategoryId: null,
      AssignedTo: null,
      BreachedOnly: 0,
    });
  });

  it("forwards CategoryId when the category filter changes", async () => {
    renderPage();
    await pickOption("filter-category", "Billing");
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.extraParams).toEqual({
      StageId: null,
      Priority: null,
      CategoryId: 5,
      AssignedTo: null,
      BreachedOnly: 0,
    });
  });

  it("forwards AssignedTo when the assignee filter changes", async () => {
    renderPage();
    await pickOption("filter-assignee", "Bob");
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.extraParams).toEqual({
      StageId: null,
      Priority: null,
      CategoryId: null,
      AssignedTo: 2,
      BreachedOnly: 0,
    });
  });

  it("forwards BreachedOnly=1 when the SLA filter is set", async () => {
    renderPage();
    await pickOption("filter-sla", "Breached only");
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.extraParams).toEqual({
      StageId: null,
      Priority: null,
      CategoryId: null,
      AssignedTo: null,
      BreachedOnly: 1,
    });
  });

  it("navigates to the ticket detail route when a row is clicked", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const rowProps = cfg.muiTableBodyRowProps({ row: { original: { Id: 42 } } });
    rowProps.onClick();
    expect(mockNavigate).toHaveBeenCalledWith("/support/tickets/42");
  });
});
