import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";

import LeadPartnerCard from "./LeadPartnerCard";
import useAuthStore from "../../stores/useAuthStore";
import { buildTheme } from "../../theme";

const ui = (props) => render(<ThemeProvider theme={buildTheme("light")}><LeadPartnerCard {...props} /></ThemeProvider>);
const LEAD = { PartnerId: 3, PartnerName: "Sharma Traders", CommType: "pct", CommValue: 10 };
const ROW = { Id: 1, Amount: 10000, Status: "earned", Reverted: false, PaidAt: null, PaidRef: null };

describe("LeadPartnerCard", () => {
  beforeEach(() => useAuthStore.setState({ access: null }));

  it("renders nothing when no partner sent the lead", () => {
    ui({ lead: { PartnerId: null } });
    expect(screen.queryByTestId("lead-partner-card")).toBeNull();
  });

  it("without partners view shows only who sent it", () => {
    ui({ lead: { PartnerId: 3, PartnerName: "Sharma Traders" }, commissions: [] });
    expect(screen.getByText("Sent by Sharma Traders")).toBeInTheDocument();
    expect(screen.queryByText(/Commission/)).toBeNull();
  });

  it("with view shows terms and the latest commission with paid date and ref", () => {
    useAuthStore.setState({ access: { isAdmin: false, modules: { partners: { view: true } } } });
    ui({ lead: LEAD, commissions: [{ ...ROW, Status: "paid", PaidAt: "2026-10-05T00:00:00Z", PaidRef: "UTR123" }, { ...ROW, Id: 0 }] });
    expect(screen.getByText("Commission: 10%")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText(/UTR123/)).toBeInTheDocument();
    expect(screen.getByTestId("partner-commission")).toHaveTextContent("10,000");
  });

  it("shows None for no terms, no commission row yet, and warns on a reverted one", () => {
    useAuthStore.setState({ access: { isAdmin: false, modules: { partners: { view: true } } } });
    const { unmount } = ui({ lead: { ...LEAD, CommType: null, CommValue: null }, commissions: [] });
    expect(screen.getByText("Commission: None")).toBeInTheDocument();
    expect(screen.queryByTestId("partner-commission")).toBeNull();
    unmount();
    ui({ lead: LEAD, commissions: [{ ...ROW, Reverted: true }] });
    expect(screen.getByText("Lead no longer converted")).toBeInTheDocument();
  });
});
