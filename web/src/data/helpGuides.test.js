import { describe, it, expect } from "vitest";
import { HELP_GUIDES } from "./helpGuides";

// Every hi/en string of a guide, steps and sections alike.
const texts = (g) => JSON.stringify(g);

describe("help guides use the access-model words (§4)", () => {
  it.each(["leads", "tickets"])("%s has no Transfer, Owner, Assignee or Branch", (key) => {
    expect(texts(HELP_GUIDES[key])).not.toMatch(/Transfer|Owner|Assignee|Branch|ट्रांसफर/);
  });

  it.each(["leads", "tickets"])("%s explains Reassign, Send back, Can see / Can assign to and Away today in both languages", (key) => {
    for (const step of ["Reassign", "Send back", "Can see", "Can assign to", "Away today"]) {
      const hits = HELP_GUIDES[key].steps.filter((s) => s.en.includes(step) && s.hi.includes(step));
      expect(hits.length, step).toBeGreaterThan(0);
    }
  });

  it("the complaints guide explains Logged by me in both languages", () => {
    expect(HELP_GUIDES.tickets.steps.some((s) => s.en.includes("Logged by me") && s.hi.includes("Logged by me"))).toBe(true);
  });
});
