import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@mui/material/styles";
import dayjs from "dayjs";

import { buildTheme } from "../../theme";

const FIXTURE_LEADS = [
  { Id: 101, Name: "Acme Corp" },
  { Id: 102, Name: "Globex" },
];

const FIXTURE_FOLLOWUPS = [
  {
    Id: 11,
    LeadId: 101,
    NextFollowupDate: "2026-07-10",
    FollowupType: "Call",
    Status: "Pending",
    Remarks: "Send quote",
  },
  {
    Id: 12,
    LeadId: 999,
    NextFollowupDate: null,
    FollowupType: null,
    Status: null,
    Remarks: null,
  },
  {
    Id: 13,
    LeadId: 102,
    NextFollowupDate: "2026-07-01",
    FollowupType: "Visit",
    Status: "Done",
    Remarks: "Wrapped up",
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
    table: { __options: { data: FIXTURE_FOLLOWUPS } },
    data: FIXTURE_FOLLOWUPS,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    totalRecords: FIXTURE_FOLLOWUPS.length,
  })),
}));

vi.mock("../../hooks/useApiQuery", () => ({
  useApiQuery: vi.fn(() => ({ data: { leads: FIXTURE_LEADS } })),
}));

const mutation = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../hooks/useApiMutation", () => ({
  useApiMutation: vi.fn(() => ({
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: false,
  })),
}));

vi.mock("material-react-table", () => ({
  MaterialReactTable: ({ table }) => (
    <div data-testid="mrt-root">
      {(table?.__options?.data ?? []).map((row) => (
        <div key={row.Id} data-testid={`followup-row-${row.Id}`}>
          {row.Remarks}
        </div>
      ))}
    </div>
  ),
}));

import FollowUps, { isFollowupOverdue } from "./FollowUps";
import useServerTable from "../../hooks/useServerTable";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";

const renderPage = () =>
  render(
    <ThemeProvider theme={buildTheme("light")}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <FollowUps />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );

// Row-action buttons come from the useServerTable config; render them inside
// the page's providers so clicks drive the page's state (modals etc).
const renderRowActions = (followup) => {
  const cfg = useServerTable.mock.calls.at(-1)[0];
  render(
    <ThemeProvider theme={buildTheme("light")}>
      {cfg.renderRowActions({ row: { original: followup } })}
    </ThemeProvider>
  );
};

const pickOption = async (testId, optionName) => {
  const user = userEvent.setup();
  await user.click(screen.getByTestId(`${testId}-input`));
  await user.click(await screen.findByRole("option", { name: optionName }));
};

const YESTERDAY = dayjs().subtract(1, "day").format("YYYY-MM-DD");
const TOMORROW = dayjs().add(1, "day").format("YYYY-MM-DD");

describe("Sales Follow-ups page", () => {
  beforeEach(() => {
    useServerTable.mockClear();
    useApiQuery.mockClear();
    useApiMutation.mockClear();
    mutation.mutate.mockClear();
    mutation.mutateAsync.mockClear();
    mockNavigate.mockClear();
  });

  it("wires useServerTable to fetchFollowups with dataKey=followups, LeadId:0 and no status filter", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.endpoint).toBe("/api/followups/fetchFollowups");
    expect(cfg.dataKey).toBe("followups");
    expect(cfg.extraParams).toEqual({ LeadId: 0, Status: null });
    expect(cfg.enableRowActions).toBe(true);
  });

  it("defines the follow-up columns in order", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const keys = cfg.columns.map((c) => c.accessorKey);
    expect(keys).toEqual([
      "LeadId",
      "NextFollowupDate",
      "FollowupType",
      "Status",
      "Remarks",
    ]);
  });

  it("renders rows from the server table", () => {
    renderPage();
    expect(screen.getByTestId("followup-row-11")).toBeInTheDocument();
    expect(screen.getByText("Send quote")).toBeInTheDocument();
  });

  it("resolves the Lead column to its name and falls back to Lead #id", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const leadCol = cfg.columns.find((c) => c.accessorKey === "LeadId");
    expect(leadCol.Cell({ cell: { getValue: () => 101 } })).toBe("Acme Corp");
    expect(leadCol.Cell({ cell: { getValue: () => 999 } })).toBe("Lead #999");
    expect(leadCol.Cell({ cell: { getValue: () => null } })).toBe("—");
  });

  it("formats NextFollowupDate and falls back to a dash", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const dateCol = cfg.columns.find((c) => c.accessorKey === "NextFollowupDate");
    const { container } = render(
      dateCol.Cell({
        row: { original: { NextFollowupDate: "2026-07-10", Status: "Done" } },
        cell: { getValue: () => "2026-07-10" },
      })
    );
    expect(container).toHaveTextContent("10-Jul-2026");
    const { container: empty } = render(
      dateCol.Cell({ row: { original: {} }, cell: { getValue: () => null } })
    );
    expect(empty).toHaveTextContent("—");
  });

  it("defaults an empty Status to Pending", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const statusCol = cfg.columns.find((c) => c.accessorKey === "Status");
    expect(statusCol.Cell({ cell: { getValue: () => "Done" } })).toBe("Done");
    expect(statusCol.Cell({ cell: { getValue: () => null } })).toBe("Pending");
  });

  it("bulk-loads leads to resolve names", () => {
    renderPage();
    const call = useApiQuery.mock.calls.find(
      ([cfg]) => cfg.endpoint === "/api/leads/fetchLeads"
    );
    expect(call[0].params).toEqual({ PageNumber: 1, PageSize: 1000 });
  });

  it("drives the Status param from the status filter", async () => {
    renderPage();
    await pickOption("filter-status", "Done");
    const cfg = useServerTable.mock.calls.at(-1)[0];
    expect(cfg.extraParams).toEqual({ LeadId: 0, Status: "Done" });
  });

  it("navigates to the lead detail route when a row is clicked", () => {
    renderPage();
    const cfg = useServerTable.mock.calls.at(-1)[0];
    const rowProps = cfg.muiTableBodyRowProps({ row: { original: { LeadId: 42 } } });
    rowProps.onClick();
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads/42");
  });

  describe("overdue highlighting", () => {
    it("flags a past-due pending follow-up, but not done/future/undated ones", () => {
      expect(
        isFollowupOverdue({ NextFollowupDate: YESTERDAY, Status: "Pending" })
      ).toBe(true);
      // No status yet counts as Pending.
      expect(isFollowupOverdue({ NextFollowupDate: YESTERDAY, Status: null })).toBe(true);
      expect(isFollowupOverdue({ NextFollowupDate: YESTERDAY, Status: "Done" })).toBe(false);
      expect(
        isFollowupOverdue({ NextFollowupDate: TOMORROW, Status: "Pending" })
      ).toBe(false);
      expect(isFollowupOverdue({ NextFollowupDate: null, Status: "Pending" })).toBe(false);
    });

    it("tints overdue rows via muiTableBodyRowProps", () => {
      renderPage();
      const cfg = useServerTable.mock.calls.at(-1)[0];
      const overdue = cfg.muiTableBodyRowProps({
        row: { original: { NextFollowupDate: YESTERDAY, Status: "Pending" } },
      });
      expect(overdue.sx.backgroundColor).toBeTruthy();
      const fine = cfg.muiTableBodyRowProps({
        row: { original: { NextFollowupDate: YESTERDAY, Status: "Done" } },
      });
      expect(fine.sx.backgroundColor).toBeUndefined();
    });
  });

  describe("row actions", () => {
    it("Mark done saves the row back with Status Done", async () => {
      renderPage();
      renderRowActions(FIXTURE_FOLLOWUPS[0]);
      const user = userEvent.setup();
      await user.click(screen.getByTestId("complete-followup-11"));
      expect(mutation.mutate).toHaveBeenCalledWith({
        Id: 11,
        LeadId: 101,
        NextFollowupDate: "2026-07-10",
        FollowupType: "Call",
        Remarks: "Send quote",
        Status: "Done",
      });
    });

    it("hides Mark done on a follow-up that is already done", () => {
      renderPage();
      renderRowActions(FIXTURE_FOLLOWUPS[2]);
      expect(screen.queryByTestId("complete-followup-13")).not.toBeInTheDocument();
      expect(screen.getByTestId("reschedule-followup-13")).toBeInTheDocument();
      expect(screen.getByTestId("delete-followup-13")).toBeInTheDocument();
    });

    it("Reschedule opens a date prompt and saves the row with the picked date", async () => {
      renderPage();
      renderRowActions(FIXTURE_FOLLOWUPS[0]);
      const user = userEvent.setup();
      await user.click(screen.getByTestId("reschedule-followup-11"));
      expect(await screen.findByTestId("reschedule-modal")).toBeInTheDocument();
      // Date prefilled from the row, so save is immediately possible.
      await user.click(screen.getByTestId("reschedule-submit"));
      expect(mutation.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          Id: 11,
          NextFollowupDate: "2026-07-10",
          Status: "Pending",
        })
      );
    });

    it("Delete asks for confirmation before calling deleteFollowup", async () => {
      renderPage();
      renderRowActions(FIXTURE_FOLLOWUPS[0]);
      const user = userEvent.setup();
      await user.click(screen.getByTestId("delete-followup-11"));
      expect(await screen.findByTestId("delete-followup-modal")).toBeInTheDocument();
      expect(mutation.mutateAsync).not.toHaveBeenCalled();
      await user.click(screen.getByTestId("delete-followup-confirm"));
      expect(mutation.mutateAsync).toHaveBeenCalledWith({ Id: 11 });
    });

    it("cancelling the delete prompt calls nothing", async () => {
      renderPage();
      renderRowActions(FIXTURE_FOLLOWUPS[0]);
      const user = userEvent.setup();
      await user.click(screen.getByTestId("delete-followup-11"));
      await screen.findByTestId("delete-followup-modal");
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(mutation.mutateAsync).not.toHaveBeenCalled();
    });

    it("colors only overdue dates red in the date cell", () => {
      renderPage();
      const cfg = useServerTable.mock.calls.at(-1)[0];
      const dateCol = cfg.columns.find((c) => c.accessorKey === "NextFollowupDate");
      const { container: overdue } = render(
        dateCol.Cell({
          row: { original: { NextFollowupDate: YESTERDAY, Status: "Pending" } },
          cell: { getValue: () => YESTERDAY },
        })
      );
      expect(overdue.querySelector("span").style.color).not.toBe("");
      const { container: fine } = render(
        dateCol.Cell({
          row: { original: { NextFollowupDate: TOMORROW, Status: "Pending" } },
          cell: { getValue: () => TOMORROW },
        })
      );
      expect(fine.querySelector("span").style.color).toBe("");
    });

    it("Mark done on a row with null fields defaults them in the payload", async () => {
      renderPage();
      renderRowActions(FIXTURE_FOLLOWUPS[1]);
      const user = userEvent.setup();
      await user.click(screen.getByTestId("complete-followup-12"));
      expect(mutation.mutate).toHaveBeenCalledWith({
        Id: 12,
        LeadId: 999,
        NextFollowupDate: null,
        FollowupType: null,
        Remarks: null,
        Status: "Done",
      });
    });

    it("Reschedule on a row with no stored date starts empty and blocks save", async () => {
      renderPage();
      renderRowActions(FIXTURE_FOLLOWUPS[1]);
      const user = userEvent.setup();
      await user.click(screen.getByTestId("reschedule-followup-12"));
      expect(await screen.findByTestId("reschedule-modal")).toBeInTheDocument();
      expect(screen.getByTestId("reschedule-submit")).toBeDisabled();
      expect(mutation.mutateAsync).not.toHaveBeenCalled();
    });

    it("wires save and delete mutations to the follow-up endpoints", () => {
      renderPage();
      const endpoints = useApiMutation.mock.calls.map(([cfg]) => cfg.endpoint);
      expect(endpoints).toContain("/api/followups/saveFollowup");
      expect(endpoints).toContain("/api/followups/deleteFollowup");
    });
  });
});
