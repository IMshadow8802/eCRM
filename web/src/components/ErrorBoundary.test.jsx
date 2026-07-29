import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary";

function Boom() {
  throw new Error("kaboom");
}

afterEach(() => vi.restoreAllMocks());

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">ok</div>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.queryByTestId("error-boundary")).not.toBeInTheDocument();
  });

  it("catches a render crash and shows the recoverable fallback instead of a blank screen", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("error-boundary")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByTestId("error-boundary-reload")).toBeInTheDocument();
  });

  it("clears the error and re-renders children on Try again", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let crash = true;
    function Maybe() {
      if (crash) throw new Error("kaboom");
      return <div data-testid="recovered">recovered</div>;
    }
    render(
      <ErrorBoundary>
        <Maybe />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("error-boundary")).toBeInTheDocument();
    crash = false;
    fireEvent.click(screen.getByTestId("error-boundary-dismiss"));
    expect(screen.getByTestId("recovered")).toBeInTheDocument();
  });
});
