import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@mui/material/styles";
import dayjs from "dayjs";

import { buildTheme } from "../../theme";

// The queue is a work list, not a lead list: an open row can be logged,
// skipped or deleted; a logged one is history and carries no actions.
const ROWS = [
  { Id: 21, LeadId: 9, LeadName: "Sharma", Type: "call", DueAt: "2026-09-01T00:00:00Z", Status: "open", AssignedToName: "Bob", IsOverdue: true },
  { Id: 20, LeadId: 9, LeadName: "Sharma", Type: "visit", DueAt: "2026-08-30T00:00:00Z", Status: "done", Outcome: "Connected", Remarks: "ok" },
];

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

// The page's job is to hand useServerTable the right config; the row actions
// come back out through the mocked table so clicks drive the page's own state.
vi.mock("../../hooks/useServerTable", () => ({
  __esModule: true,
  default: vi.fn((cfg) => ({
    table: { __options: { data: ROWS, renderRowActions: cfg.renderRowActions } },
    data: ROWS, isLoading: false, isFetching: false, error: null, refetch: vi.fn(), totalRecords: ROWS.length,
  })),
}));

vi.mock("material-react-table", () => ({
  MaterialReactTable: ({ table }) => (
    <div data-testid="mrt-root">
      {(table?.__options?.data ?? []).map((row) => (
        <div key={row.Id} data-testid={`followup-row-${row.Id}`}>
          {row.LeadName}
          {table.__options.renderRowActions?.({ row: { original: row } })}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("./LogFollowUpModal", () => ({
  __esModule: true,
  default: ({ open, followUp }) => (open ? <div data-testid="log-modal">{String(followUp?.Id)}</div> : null),
}));

// useApiMutation is real here — the assertions are about the bodies that reach
// the wire, so the shared apiClient is what gets stubbed.
const post = vi.fn();
vi.mock("../../utils/axiosConfig", () => ({ __esModule: true, apiClient: { post: (...args) => post(...args) } }));

vi.mock("notistack", async () => ({ ...(await vi.importActual("notistack")), enqueueSnackbar: vi.fn() }));

import FollowUps from "./FollowUps";
import useServerTable from "../../hooks/useServerTable";

const renderPage = () =>
  render(
    <ThemeProvider theme={buildTheme("light")}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><FollowUps /></MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );

const lastCfg = () => useServerTable.mock.calls.at(-1)[0];
const lastExtraParams = () => lastCfg().extraParams;
const cellOf = (key) => lastCfg().columns.find((c) => c.accessorKey === key).Cell;
const withTheme = (node) => render(<ThemeProvider theme={buildTheme("light")}>{node}</ThemeProvider>);

describe("Follow-ups queue", () => {
  beforeEach(() => {
    useServerTable.mockClear();
    mockNavigate.mockClear();
    post.mockReset();
    post.mockResolvedValue({ data: { success: true, data: {} } });
  });

  it("defaults to Today and maps the three tabs onto fetch params", async () => {
    renderPage();
    const today = dayjs().format("YYYY-MM-DD");
    expect(lastExtraParams()).toEqual({ LeadId: 0, Status: "open", DueFrom: today, DueTo: today });
    const user = userEvent.setup();
    await user.click(screen.getByText("Overdue"));
    expect(lastExtraParams()).toEqual({ LeadId: 0, Overdue: true });
    await user.click(screen.getByText("Upcoming"));
    expect(lastExtraParams()).toEqual({ LeadId: 0, Status: "open", DueFrom: dayjs().add(1, "day").format("YYYY-MM-DD") });
    await user.click(screen.getByText("All"));
    expect(lastExtraParams()).toEqual({ LeadId: 0 });
  });

  it("Log opens the modal for an open row; done rows have no Log/Skip/Delete", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("log-followup-21"));
    expect(screen.getByTestId("log-modal")).toHaveTextContent("21");
    expect(screen.queryByTestId("log-followup-20")).toBeNull();
    expect(screen.queryByTestId("skip-followup-20")).toBeNull();
  });

  it("Skip requires remarks and posts skipFollowUp", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("skip-followup-21"));
    expect(screen.getByTestId("skip-submit")).toBeDisabled();
    await user.type(screen.getByTestId("skip-remarks"), "Customer travelling");
    await user.click(screen.getByTestId("skip-submit"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/followups/skipFollowUp", { Id: 21, Remarks: "Customer travelling" }));
  });

  it("Delete confirms first, then posts deleteFollowup with just the Id", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("delete-followup-21"));
    expect(await screen.findByTestId("delete-followup-modal")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("delete-followup-confirm"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/followups/deleteFollowup", { Id: 21 }));
  });

  it("cancelling either prompt posts nothing", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("skip-followup-21"));
    await user.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    await user.click(screen.getByTestId("delete-followup-21"));
    await user.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    expect(post).not.toHaveBeenCalled();
  });

  it("renders the queue columns: lead + mobile, due date, type, assignee, status, outcome", () => {
    renderPage();
    expect(lastCfg().columns.map((c) => c.accessorKey)).toEqual([
      "LeadName", "DueAt", "Type", "AssignedToName", "Status", "Remarks",
    ]);

    const named = withTheme(cellOf("LeadName")({ row: { original: { LeadName: "Sharma", LeadMobile: "9990001111" } } }));
    expect(named.container).toHaveTextContent("Sharma · 9990001111");
    expect(withTheme(cellOf("LeadName")({ row: { original: { LeadName: "Sharma" } } })).container).toHaveTextContent("Sharma");

    // Overdue is a server verdict (IsOverdue), not a client date comparison.
    const late = withTheme(cellOf("DueAt")({ row: { original: { IsOverdue: true } }, cell: { getValue: () => "2026-09-01T00:00:00Z" } }));
    expect(late.container.querySelector("span")).toHaveTextContent("01-09-2026");
    expect(late.container.querySelector("span").style.fontWeight).toBe("600");
    const onTime = withTheme(cellOf("DueAt")({ row: { original: { IsOverdue: false } }, cell: { getValue: () => null } }));
    expect(onTime.container.querySelector("span").style.fontWeight).toBe("");
    expect(onTime.container).toHaveTextContent("—");

    expect(cellOf("Type")({ cell: { getValue: () => "call" } })).toBe("Call");
    expect(cellOf("Type")({ cell: { getValue: () => "webinar" } })).toBe("webinar");
    expect(cellOf("AssignedToName")({ cell: { getValue: () => "Bob" } })).toBe("Bob");
    expect(cellOf("AssignedToName")({ cell: { getValue: () => null } })).toBe("—");

    withTheme(cellOf("Status")({ cell: { getValue: () => "open" } }));
    expect(screen.getByText("open")).toBeInTheDocument();
    withTheme(cellOf("Status")({ cell: { getValue: () => "done" } }));
    expect(screen.getByText("done")).toBeInTheDocument();

    expect(cellOf("Remarks")({ row: { original: { Outcome: "Connected", Remarks: "ok" } } })).toBe("Connected — ok");
    expect(cellOf("Remarks")({ row: { original: {} } })).toBe("—");
  });

  it("a row click opens that follow-up's lead", () => {
    renderPage();
    lastCfg().muiTableBodyRowProps({ row: { original: { LeadId: 9 } } }).onClick();
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads/9");
    expect(lastCfg().getRowId({ Id: 21 })).toBe(21);
    expect(lastCfg().dataKey).toBe("followups");
    expect(lastCfg().endpoint).toBe("/api/followups/fetchFollowups");
  });
});
