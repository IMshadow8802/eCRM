import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import PageHeader from "./PageHeader";
import { Home } from "lucide-react";

const wrap = (ui) => render(<ThemeProvider theme={buildTheme()}>{ui}</ThemeProvider>);

describe("PageHeader", () => {
  it("renders title + subtitle", () => {
    wrap(<PageHeader title="Dashboard" subtitle="At a glance" data-testid="h" />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("At a glance")).toBeInTheDocument();
  });

  it("breadcrumb with links", () => {
    wrap(
      <PageHeader
        title="X"
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Tasks" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
  });

  it("icon + actions + tabs slots render", () => {
    wrap(
      <PageHeader
        title="X"
        icon={<Home />}
        actions={<button data-testid="btn">New</button>}
        tabs={<div data-testid="tabs">tabs</div>}
      />,
    );
    expect(screen.getByTestId("btn")).toBeInTheDocument();
    expect(screen.getByTestId("tabs")).toBeInTheDocument();
  });

  it("no breadcrumb renders fine", () => {
    wrap(<PageHeader title="X" />);
    expect(screen.getByText("X")).toBeInTheDocument();
  });
});

// Regression, 2026-09-19: the actions slot was `inline-flex; flexShrink: 0`
// with no wrap. The row above it wraps, which lets the whole block drop under
// the title, but never breaks it internally — so a detail page's ~570px of
// actions ran straight off a 336px screen and `<main>`'s `overflowX: hidden`
// clipped the primary button away entirely.
describe("actions overflow", () => {
  it("lets a crowded action cluster wrap instead of running off screen", () => {
    wrap(
      <PageHeader
        title="Lead"
        actions={
          <>
            <button type="button">Edit</button>
            <button type="button">Transfer</button>
            <button type="button">Schedule follow-up</button>
          </>
        }
      />,
    );
    const slot = screen.getByRole("button", { name: "Edit" }).parentElement;
    expect(slot.style.flexWrap).toBe("wrap");
    expect(slot.style.flexShrink).not.toBe("0");
  });
});
