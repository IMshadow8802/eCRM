import { describe, it, expect } from "vitest";
import { TODAY } from "./todayQueries";

describe("TODAY endpoints", () => {
  it("maps the four /api/today routes", () => {
    expect(TODAY).toEqual({
      mine: "/api/today/mine",
      team: "/api/today/team",
      teamSize: "/api/today/teamSize",
      personTasks: "/api/today/personTasks",
    });
  });
});
