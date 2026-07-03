import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";

import { buildTheme } from "../../theme";
import Timeline from "./Timeline";

const wrap = (ui) => render(<ThemeProvider theme={buildTheme("light")}>{ui}</ThemeProvider>);

describe("Timeline", () => {
  it("shows an empty state when there is no activity", () => {
    wrap(<Timeline activity={[]} />);
    expect(screen.getByText(/No activity yet/i)).toBeInTheDocument();
  });

  it("defaults activity to an empty state when the prop is omitted", () => {
    wrap(<Timeline />);
    expect(screen.getByText(/No activity yet/i)).toBeInTheDocument();
  });

  it("lists activity chronologically (oldest first), regardless of input order", () => {
    wrap(
      <Timeline
        activity={[
          { Id: 2, Type: "stage_changed", CreatedAt: "2026-01-02T10:00:00Z" },
          { Id: 1, Type: "created", CreatedAt: "2026-01-01T10:00:00Z" },
        ]}
      />,
    );
    const items = screen.getAllByTestId("timeline-item");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Created");
    expect(items[1]).toHaveTextContent("Stage changed");
  });

  it("renders the Summary line when present", () => {
    wrap(
      <Timeline
        activity={[
          {
            Id: 1,
            Type: "field_changed",
            Summary: "Budget changed to 5000",
            CreatedAt: "2026-01-01T10:00:00Z",
          },
        ]}
      />,
    );
    expect(screen.getByText("Budget changed to 5000")).toBeInTheDocument();
  });

  it("falls back to a generic label when Type is missing", () => {
    wrap(<Timeline activity={[{ Id: 1, CreatedAt: "2026-01-01T10:00:00Z" }]} />);
    expect(screen.getByText("Activity")).toBeInTheDocument();
  });
});
