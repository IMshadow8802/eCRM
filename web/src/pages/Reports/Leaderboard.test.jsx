import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

import Leaderboard from "./Leaderboard";
import renderWithProviders from "../../test/renderWithProviders";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

describe("Leaderboard report", () => {
  it("renders the ranked table with no KPI strip, trend, GroupBy tabs or basis picker, and drills into the rep's leads for the range", async () => {
    const cap = mockReportEndpoints("/api/reports/leaderboard", reportData({
      rows: [
        { GroupKey: 17, GroupLabel: "Amit Singh", Created: 40, Qualified: 12, Activities: 150, OnTimePct: 82.5, AvgResponseHours: 3.2, Rank: 1 },
        { GroupKey: 18, GroupLabel: "Sara Khan", Created: 30, Qualified: 7, Activities: 90, OnTimePct: 70, AvgResponseHours: 9.8, Rank: 2 },
      ],
    }));
    renderWithProviders(<Leaderboard />, { route: "/reports/leaderboard?preset=custom&from=2026-08-01&to=2026-08-31" });
    const table = await screen.findByTestId("leaderboard-table");
    expect(cap.body).toMatchObject({ GroupBy: "owner" });
    expect(screen.queryByTestId("report-kpis")).toBeNull();
    expect(screen.queryByTestId("trend-area")).toBeNull();
    expect(screen.queryByTestId("report-groupby")).toBeNull();
    expect(screen.queryByTestId("report-basis-input")).toBeNull();
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      ["#", "Rep", "Leads", "Qualified", "Activities", "On-time %", "Avg response"],
    );
    expect(within(table).getByText("3.2 h")).toBeInTheDocument();
    await userEvent.setup().click(within(table).getByText("Sara Khan"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?from=2026-08-01&to=2026-08-31&OwnerId=18");
  });
});
