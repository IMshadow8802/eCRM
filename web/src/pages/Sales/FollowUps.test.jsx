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
let ROWS;
const BASE_ROWS = [
  { Id: 21, Via: 1, LeadId: 9, LeadName: "Sharma", Type: "call", DueAt: "2026-09-01T00:00:00", Status: "open", AssignedToName: "Bob", IsOverdue: true },
  { Id: 20, Via: 1, LeadId: 9, LeadName: "Sharma", Type: "visit", DueAt: "2026-08-30T00:00:00", Status: "done", Outcome: "Connected", Remarks: "ok" },
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

vi.mock("./RescheduleFollowUpModal", () => ({
  __esModule: true,
  default: ({ open, followUp }) => (open ? <div data-testid="reschedule-modal">{String(followUp?.Id)}</div> : null),
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
    ROWS = BASE_ROWS;
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

  it("Reschedule opens the modal for an open row; done rows have none", async () => {
    renderPage();
    const user = userEvent.setup();
    expect(screen.queryByTestId("reschedule-followup-20")).toBeNull();
    await user.click(screen.getByTestId("reschedule-followup-21"));
    expect(screen.getByTestId("reschedule-modal")).toHaveTextContent("21");
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
    const late = withTheme(cellOf("DueAt")({ row: { original: { IsOverdue: true } }, cell: { getValue: () => "2026-09-01T15:30:00" } }));
    expect(late.container.querySelector("span")).toHaveTextContent("01-09-2026 15:30");
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
    // 119: a lead closed as won/lost cancels its open follow-ups.
    withTheme(cellOf("Status")({ cell: { getValue: () => "cancelled" } }));
    expect(screen.getByText("cancelled")).toBeInTheDocument();

    expect(cellOf("Remarks")({ row: { original: { Outcome: "Connected", Remarks: "ok" } } })).toBe("Connected — ok");
    expect(cellOf("Remarks")({ row: { original: {} } })).toBe("—");
  });

  // The owner's complaint: nothing said these icons led anywhere. The eye is
  // on every row — a logged follow-up still has a history worth opening.
  it("every row carries an eye that opens the lead, done rows included", async () => {
    renderPage();
    const user = userEvent.setup();
    expect(screen.getByTestId("view-lead-20")).toBeInTheDocument();
    await user.click(screen.getByTestId("view-lead-20"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads/9");
    expect(screen.getByTestId("view-lead-21")).toHaveAttribute("data-tone", "primary");
  });

  it("colours the three actions by what they do", () => {
    renderPage();
    expect(screen.getByTestId("log-followup-21")).toHaveAttribute("data-tone", "success");
    expect(screen.getByTestId("skip-followup-21")).toHaveAttribute("data-tone", "warning");
    expect(screen.getByTestId("delete-followup-21")).toHaveAttribute("data-tone", "error");
  });

  it("the lead name is a link into the lead, not just text", async () => {
    renderPage();
    // The row underneath navigates too — the link must swallow the click so
    // the two handlers don't both fire.
    const rowClick = vi.fn();
    const { container } = withTheme(
      <div onClick={rowClick}>
        {cellOf("LeadName")({ row: { original: { Id: 21, Via: 1, LeadId: 9, LeadName: "Sharma", LeadMobile: "9990001111" } } })}
      </div>,
    );
    expect(container).toHaveTextContent("Sharma · 9990001111");
    await userEvent.setup().click(screen.getByTestId("lead-link-21"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads/9");
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("a row click opens that follow-up's lead", () => {
    renderPage();
    lastCfg().muiTableBodyRowProps({ row: { original: { Via: 1, LeadId: 9 } } }).onClick();
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads/9");
    expect(lastCfg().getRowId({ Id: 21 })).toBe(21);
    expect(lastCfg().dataKey).toBe("followups");
    expect(lastCfg().endpoint).toBe("/api/followups/fetchFollowups");
  });

  // Access model: Via 2 = an open follow-up given to the caller on a lead they
  // cannot see; Via 3 = a manager's look-only line. Neither opens the lead.
  const VIA2 = { Id: 31, Via: 2, LeadId: 50, LeadName: "Mehta", LeadCompany: "Mehta Steel", LeadMobile: "9876500000", Type: "call", Status: "open", AssignedToName: "Me" };
  const VIA3 = { Id: 32, Via: 3, LeadId: 51, LeadName: "Joshi", LeadCompany: "Joshi Traders", LeadMobile: "9876511111", Type: "visit", Status: "open", AssignedToName: "Vivek" };

  it("Via 3 row has no phone and no actions", () => {
    ROWS = [VIA3];
    renderPage();
    const row = screen.getByTestId("followup-row-32");
    expect(screen.queryByTestId("view-lead-32")).toBeNull();
    for (const a of ["log", "reschedule", "skip", "delete"]) expect(screen.queryByTestId(`${a}-followup-32`)).toBeNull();
    expect(row).toBeInTheDocument();

    const cell = withTheme(cellOf("LeadName")({ row: { original: VIA3 } }));
    expect(cell.container).toHaveTextContent("Joshi · Joshi Traders");
    expect(cell.container).toHaveTextContent("Assigned to Vivek");
    expect(cell.container).not.toHaveTextContent("9876511111");
    expect(screen.queryByTestId("lead-link-32")).toBeNull();
    const props = lastCfg().muiTableBodyRowProps({ row: { original: VIA3 } });
    expect(props.onClick).toBeUndefined();
  });

  it("Via 2 row keeps phone and actions but does not open the lead", () => {
    ROWS = [VIA2];
    renderPage();
    expect(screen.getByTestId("log-followup-31")).toBeInTheDocument();
    // Reschedule books on the lead, which a Via 2 caller cannot see.
    expect(screen.queryByTestId("reschedule-followup-31")).toBeNull();
    expect(screen.getByTestId("skip-followup-31")).toBeInTheDocument();
    expect(screen.getByTestId("delete-followup-31")).toBeInTheDocument();
    expect(screen.queryByTestId("view-lead-31")).toBeNull();
    const cell = withTheme(cellOf("LeadName")({ row: { original: VIA2 } }));
    expect(cell.container).toHaveTextContent("Mehta · Mehta Steel · 9876500000");
    expect(screen.queryByTestId("lead-link-31")).toBeNull();
    expect(lastCfg().muiTableBodyRowProps({ row: { original: VIA2 } }).onClick).toBeUndefined();
  });

  // 403 = the follow-up is still visible but the action is refused: say the
  // server's words and stay. 404 = it is gone: close and reload.
  it("a 403 on skip shows the server's message and keeps the prompt open", async () => {
    const { enqueueSnackbar } = await import("notistack");
    post.mockRejectedValueOnce({ response: { status: 403, data: { message: "You can view this follow-up but not act on it" } } });
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("skip-followup-21"));
    await user.type(screen.getByTestId("skip-remarks"), "x");
    await user.click(screen.getByTestId("skip-submit"));
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalledWith("You can view this follow-up but not act on it", { variant: "error" }));
    expect(screen.getByTestId("skip-remarks")).toBeInTheDocument();
  });

  it("any other failure on delete keeps the prompt open with the server's message", async () => {
    const { enqueueSnackbar } = await import("notistack");
    post.mockRejectedValueOnce({ response: { status: 500, data: { message: "Boom" } } });
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("delete-followup-21"));
    await user.click(screen.getByTestId("delete-followup-confirm"));
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalledWith("Boom", { variant: "error" }));
    expect(screen.getByTestId("delete-followup-modal")).toBeInTheDocument();
  });

  it("a 404 on delete closes the prompt and says the record is no longer with you", async () => {
    const { enqueueSnackbar } = await import("notistack");
    post.mockRejectedValueOnce({ response: { status: 404, data: { code: "NOT_FOUND" } } });
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("delete-followup-21"));
    await user.click(screen.getByTestId("delete-followup-confirm"));
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalledWith("This record is no longer with you", { variant: "error" }));
    await waitFor(() => expect(screen.queryByTestId("delete-followup-confirm")).toBeNull());
  });
});
