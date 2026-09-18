import { describe, it, expect, afterEach } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import BrandPanel from "./BrandPanel";
import renderWithProviders from "../../test/renderWithProviders";

afterEach(cleanup);

describe("BrandPanel — before a company code is typed", () => {
  it("shows our own brand, since we do not know whose CRM this is yet", () => {
    renderWithProviders(<BrandPanel />);
    expect(screen.getByText("Nexus CRM")).toBeInTheDocument();
    expect(screen.getByText(/one login, every company/i)).toBeInTheDocument();
  });

  it("shows the promise, and nothing is pitched under it", () => {
    renderWithProviders(<BrandPanel />);
    expect(screen.getByText(/Every complaint on a clock/i)).toBeInTheDocument();
    // The three capability bullets were removed 2026-09-18: a pitch aimed at a
    // buyer, on a screen only existing staff ever see.
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});

describe("BrandPanel — bound to a company", () => {
  const SOLAR = {
    companyName: "Solar Care",
    compCode: "SOLAR",
    baseURL: "https://shadowcodes.in/SolarCRM",
  };

  it("takes the company's name", () => {
    renderWithProviders(<BrandPanel {...SOLAR} />);
    expect(screen.getByText("Solar Care")).toBeInTheDocument();
  });

  // Support's first question on any "it won't log in" call is which backend the
  // browser is actually talking to. The answer is on the screen.
  it("names the host it will sign you in to, without the scheme", () => {
    renderWithProviders(<BrandPanel {...SOLAR} />);
    expect(screen.getByText(/shadowcodes\.in\/SolarCRM/)).toBeInTheDocument();
    expect(screen.queryByText(/https:\/\//)).toBeNull();
  });

  it("shows the company's logo when there is one", () => {
    renderWithProviders(<BrandPanel {...SOLAR} logoURL="https://cdn.example/solar.png" />);
    expect(screen.getByRole("img", { name: /Solar Care/i })).toHaveAttribute(
      "src",
      "https://cdn.example/solar.png",
    );
  });

  // A dead logo URL in Central must not leave a broken-image glyph on the
  // sign-in page of every user at that company.
  it("falls back to the initial when the logo fails to load", () => {
    renderWithProviders(<BrandPanel {...SOLAR} logoURL="https://cdn.example/gone.png" />);
    fireEvent.error(screen.getByRole("img", { name: /Solar Care/i }));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("S")).toBeInTheDocument();
  });

  /**
   * Central also returns a PrimaryColor. It belongs to another product and is
   * deliberately not wired in here (2026-09-17) — the panel is always our own
   * brand gradient. This test fails the moment someone reintroduces it as a
   * prop, which is the point: the removal was an instruction, not a preference.
   */
  it("ignores a colour prop entirely — the panel is always our brand", () => {
    const { container } = renderWithProviders(<BrandPanel {...SOLAR} />);
    const withColour = container.querySelector('[data-testid="brand-panel"]').className;
    cleanup();
    const second = renderWithProviders(<BrandPanel {...SOLAR} primaryColor="#ff8a00" />);
    expect(
      second.container.querySelector('[data-testid="brand-panel"]').className,
    ).toBe(withColour);
  });
});
