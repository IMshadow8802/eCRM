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

  // SQL 067 made ticket calls readable. The activity row only says a call
  // happened; tblCall holds what was said, so the richer row must replace it
  // rather than sit next to it.
  it("replaces call activity rows with the call rows themselves", () => {
    wrap(
      <Timeline
        activity={[
          { Id: 1, Type: "created", CreatedAt: "2026-01-01T10:00:00Z" },
          { Id: 2, Type: "call", Summary: "Outbound call logged", CreatedAt: "2026-01-02T10:00:00Z" },
        ]}
        calls={[
          {
            Id: 9,
            Direction: "out",
            Notes: "Promised a callback Friday",
            Duration: 6,
            CalledAt: "2026-01-02T10:00:00Z",
          },
        ]}
      />,
    );

    const items = screen.getAllByTestId("timeline-item");
    expect(items).toHaveLength(2);
    expect(screen.queryByText("Outbound call logged")).not.toBeInTheDocument();
    expect(screen.getByText("Outgoing call")).toBeInTheDocument();
    expect(screen.getByText(/Promised a callback Friday/)).toBeInTheDocument();
    expect(screen.getByText(/6 min/)).toBeInTheDocument();
  });

  it("labels an inbound call and resolves its outcome name", () => {
    wrap(
      <Timeline
        activity={[]}
        calls={[
          { Id: 4, Direction: "in", OutcomeId: 3, CalledAt: "2026-01-02T10:00:00Z" },
        ]}
        outcomes={[{ Id: 3, Value: "Answered" }]}
      />,
    );
    expect(screen.getByText("Incoming call")).toBeInTheDocument();
    expect(screen.getByText("Answered")).toBeInTheDocument();
  });

  // Leads pass no `calls`, so their call activity rows must survive untouched.
  it("keeps call activity rows when no calls are supplied", () => {
    wrap(
      <Timeline
        activity={[
          { Id: 2, Type: "call", Summary: "Call logged", CreatedAt: "2026-01-02T10:00:00Z" },
        ]}
      />,
    );
    expect(screen.getByText("Call logged")).toBeInTheDocument();
  });

  it("shows a bare call with no notes, outcome or duration", () => {
    wrap(
      <Timeline
        activity={[]}
        calls={[{ Id: 4, Direction: "out", CalledAt: "2026-01-02T10:00:00Z" }]}
      />,
    );
    const item = screen.getByTestId("timeline-item");
    expect(item).toHaveTextContent("Outgoing call");
    expect(item).toHaveTextContent("02-01-2026");
  });

  it("falls back to CreatedAt when a call has no CalledAt", () => {
    wrap(
      <Timeline
        activity={[]}
        calls={[{ Id: 4, Direction: "out", CreatedAt: "2026-03-09T10:00:00Z" }]}
      />,
    );
    expect(screen.getByTestId("timeline-item")).toHaveTextContent("09-03-2026");
  });

  it("renders an undated entry without a timestamp rather than 'Invalid Date'", () => {
    wrap(<Timeline activity={[{ Id: 1, Type: "created" }]} />);
    const item = screen.getByTestId("timeline-item");
    expect(item).toHaveTextContent("Created");
    expect(item).not.toHaveTextContent("Invalid");
  });

  it("leaves an unknown outcome id unresolved instead of showing the number", () => {
    wrap(
      <Timeline
        activity={[]}
        calls={[{ Id: 4, Direction: "in", OutcomeId: 99, CalledAt: "2026-01-02T10:00:00Z" }]}
        outcomes={[{ Id: 3, Value: "Answered" }]}
      />,
    );
    const item = screen.getByTestId("timeline-item");
    expect(item).toHaveTextContent("Incoming call");
    expect(item).not.toHaveTextContent("99");
  });

  it("interleaves calls and activity by time", () => {
    wrap(
      <Timeline
        activity={[
          { Id: 1, Type: "created", CreatedAt: "2026-01-01T10:00:00Z" },
          { Id: 3, Type: "stage_changed", CreatedAt: "2026-01-03T10:00:00Z" },
        ]}
        calls={[{ Id: 9, Direction: "out", CalledAt: "2026-01-02T10:00:00Z" }]}
      />,
    );
    const items = screen.getAllByTestId("timeline-item");
    expect(items[0]).toHaveTextContent("Created");
    expect(items[1]).toHaveTextContent("Outgoing call");
    expect(items[2]).toHaveTextContent("Stage changed");
  });
});

// Spec 2 gave complaints four activity types sales never wrote. The map is
// the label AND the icon; anything unmapped keeps the old de-underscored type,
// which is what the legacy `stage_changed` rows still need.
describe("Timeline activity types", () => {
  it.each([
    ["created", "Created"],
    ["updated", "Updated"],
    ["status", "Status changed"],
    ["assigned", "Assigned"],
    ["resolved", "Resolved"],
    ["closed", "Closed"],
    ["rejected", "Rejected"],
    ["reopened", "Reopened"],
    ["escalated", "Escalated"],
  ])("labels %s as %s and gives it an icon", (type, label) => {
    wrap(<Timeline activity={[{ Id: 1, Type: type, CreatedAt: "2026-09-16T10:00:00Z" }]} />);
    const item = screen.getByTestId("timeline-item");
    expect(item).toHaveTextContent(label);
    expect(item).toHaveAttribute("data-type", type);
    expect(item.querySelector("svg")).toBeTruthy();
  });

  it("keeps an unmapped legacy type readable", () => {
    wrap(<Timeline activity={[{ Id: 1, Type: "stage_changed", CreatedAt: "2026-09-16T10:00:00Z" }]} />);
    const item = screen.getByTestId("timeline-item");
    expect(item).toHaveTextContent("Stage changed");
    expect(item.querySelector("svg")).toBeTruthy();
  });
});
