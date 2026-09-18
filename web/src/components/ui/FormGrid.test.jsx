import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import FormGrid, { FormGridSpan } from "./FormGrid";

afterEach(cleanup);

const gridOf = (c) => getComputedStyle(c.firstElementChild).gridTemplateColumns;

describe("FormGrid", () => {
  it("lays fields out on an auto-filling grid", () => {
    const { container } = render(<FormGrid><span>a</span></FormGrid>);
    expect(gridOf(container)).toBe("repeat(auto-fill, minmax(220px, 1fr))");
    expect(screen.getByText("a")).toBeInTheDocument();
  });

  /**
   * The column floor is the number that decides how tall a form modal gets: at
   * a 720px modal a 220px floor yields three columns, at 960px it yields four,
   * which is a whole row shorter. It was copy-pasted into four files before
   * this component existed, so widening a modal meant checking that every copy
   * agreed. Overridable, but one default.
   */
  it("takes a column floor, so a dense form can run narrower columns", () => {
    const { container } = render(<FormGrid min={160}><span>a</span></FormGrid>);
    expect(gridOf(container)).toBe("repeat(auto-fill, minmax(160px, 1fr))");
  });

  it("passes through sx without losing the grid", () => {
    const { container } = render(<FormGrid sx={{ mt: 3 }}><span>a</span></FormGrid>);
    expect(gridOf(container)).toContain("auto-fill");
  });

  it("forwards arbitrary props, so a caller can still hang a test id on it", () => {
    render(<FormGrid data-testid="fields"><span>a</span></FormGrid>);
    expect(screen.getByTestId("fields")).toBeInTheDocument();
  });
});

describe("FormGridSpan", () => {
  it("takes the full row", () => {
    const { container } = render(<FormGridSpan><span>note</span></FormGridSpan>);
    expect(getComputedStyle(container.firstElementChild).gridColumn).toBe("1/-1");
  });

  it("still accepts its own sx", () => {
    const { container } = render(<FormGridSpan sx={{ mt: 2 }}><span>note</span></FormGridSpan>);
    expect(getComputedStyle(container.firstElementChild).gridColumn).toBe("1/-1");
  });
});
