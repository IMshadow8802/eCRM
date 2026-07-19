import { describe, it, expect } from "vitest";
import { routesConfig } from "./App";

// The sidebar parent items (Sales/Support/Settings/Reports) and the rail-mode
// flyout headers navigate to the bare section path; without these redirects
// they hit the 404 catch-all.
describe("section landing redirects", () => {
  it.each([
    ["/sales", "/sales/pipeline"],
    ["/support", "/support/board"],
    ["/settings", "/settings/custom-fields"],
    ["/reports", "/reports/pipeline-funnel"],
  ])("%s redirects to %s", (from, to) => {
    const route = routesConfig.find((r) => r.path === from);
    expect(route).toBeTruthy();
    expect(route.element.props.to).toBe(to);
    expect(route.element.props.replace).toBe(true);
  });

  it("keeps the concrete child routes reachable (exact paths, not just the parent)", () => {
    const paths = routesConfig.map((r) => r.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/support/board",
        "/support/tickets",
        "/support/tickets/:ticketId",
        "/settings/ticket-categories",
      ]),
    );
  });
});
