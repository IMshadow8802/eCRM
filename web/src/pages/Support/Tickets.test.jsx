import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
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
  },
];

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

vi.mock("./TicketDetailModal", () => ({
  __esModule: true,
  default: ({ open, ticketId }) =>
    open ? <div data-testid="ticket-detail-modal">ticket:{ticketId}</div> : null,
}));

vi.mock("../../hooks/useApiQuery", () => ({
  useApiQuery: vi.fn((cfg) => {
    if (cfg?.endpoint === "/api/config/fetchPipelines") {
      return {
        data: {
          pipelines: [{ Id: 9, Name: "Support", IsDefault: true }],
          stages: [
            { Id: 3, PipelineId: 9, Name: "Open", StageType: "open" },
            { Id: 4, PipelineId: 9, Name: "Resolved", StageType: "won" },
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

const renderCell = (node) =>
  render(<ThemeProvider theme={buildTheme("light")}>{node}</ThemeProvider>);

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
      undefined, // action column (id: "open", eye icon) leads — no accessorKey
      "TicketNo",
      "CustomerName",
      "Contact",
      "Priority",
      "CategoryId",
      "StageId",
      "AssignedTo",
    ]);
  });

  it("renders rows from the server table", () => {
    renderPage();
    expect(screen.getByTestId("ticket-row-101")).toBeInTheDocument();
    expect(screen.getByText("TKT-001")).toBeInTheDocument();
  });

  // Status-ish columns render as pills so the state is scannable at a glance.
  it("renders the Priority column as a pill and falls back to a dash", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const col = cfg.columns.find((c) => c.accessorKey === "Priority");
    const { getByText } = renderCell(col.Cell({ cell: { getValue: () => 7 } }));
    expect(getByText("High")).toBeInTheDocument();
    expect(col.Cell({ cell: { getValue: () => null } })).toBe("—");
  });

  it("renders the Category column as a pill and falls back to a dash", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const col = cfg.columns.find((c) => c.accessorKey === "CategoryId");
    const { getByText } = renderCell(col.Cell({ cell: { getValue: () => 5 } }));
    expect(getByText("Billing")).toBeInTheDocument();
    expect(col.Cell({ cell: { getValue: () => null } })).toBe("—");
  });

  it("renders the Status column as a stage-type-toned pill and falls back to a dash", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const col = cfg.columns.find((c) => c.accessorKey === "StageId");
    const { getByText } = renderCell(col.Cell({ cell: { getValue: () => 3 } }));
    expect(getByText("Open")).toBeInTheDocument();
    expect(col.Cell({ cell: { getValue: () => null } })).toBe("—");
  });

  it("has an explicit open-icon column that opens the detail modal", async () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const col = cfg.columns.find((c) => c.id === "open");
    expect(col).toBeTruthy();

    const { getByTestId } = renderCell(
      col.Cell({ row: { original: { Id: 42, TicketNo: "TKT-042" } } })
    );
    act(() => {
      getByTestId("ticket-open-42").click();
    });
    expect(await screen.findByTestId("ticket-detail-modal")).toBeInTheDocument();
  });

  it("resolves the Assignee column against the bulk-loaded users list", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const col = cfg.columns.find((c) => c.accessorKey === "AssignedTo");
    expect(col.Cell({ cell: { getValue: () => 2 } })).toBe("Bob");
    expect(col.Cell({ cell: { getValue: () => null } })).toBe("—");
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
    });
  });

  // Row click opens the detail in a modal (table position preserved) instead
  // of navigating away to the full page.
  it("opens the detail modal when a row is clicked", async () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const rowProps = cfg.muiTableBodyRowProps({ row: { original: { Id: 42 } } });

    expect(screen.queryByTestId("ticket-detail-modal")).not.toBeInTheDocument();
    act(() => rowProps.onClick());
    expect(await screen.findByTestId("ticket-detail-modal")).toBeInTheDocument();
  });
});
