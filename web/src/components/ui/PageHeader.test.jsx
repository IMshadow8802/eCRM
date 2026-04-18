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
