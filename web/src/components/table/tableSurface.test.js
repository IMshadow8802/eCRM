import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A repo-wide guard, not a unit test.
 *
 * The tables are cards now — `tableDefaults` gives the Paper a real shadow.
 * A shadow is painted OUTSIDE the element's box, so any ancestor with
 * `overflow: auto` or `overflow: hidden` slices it off square. Three pages
 * (Tickets, Leads, Customers) each wrapped their table in
 * `<Box sx={{ width: "100%", overflowX: "auto" }}>`, which cut the shadow flat
 * along the bottom edge and made the rounded corners read as sharp rectangles.
 *
 * The wrapper was doing nothing anyway: MRT's own MuiTableContainer carries
 * `overflow: auto`, so horizontal scrolling lives inside the card where it
 * belongs.
 *
 * This scans source rather than rendering, because the failure is structural —
 * it cannot be seen in jsdom (no layout, no painting) and would otherwise only
 * be caught by someone looking at the screen.
 */
const PAGES = path.resolve(__dirname, "../../pages");

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.isFile() && /\.jsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [full] : [];
  });

describe("table surface", () => {
  const files = walk(PAGES).map((f) => [path.relative(PAGES, f), fs.readFileSync(f, "utf8")]);

  it("finds the pages that render a table, so this guard cannot silently scan nothing", () => {
    const withTables = files.filter(([, src]) => src.includes("<MaterialReactTable"));
    expect(withTables.length).toBeGreaterThanOrEqual(8);
  });

  it.each([
    ["overflowX", /overflowX:\s*["'](auto|scroll|hidden)["']/],
    ["overflowY", /overflowY:\s*["'](auto|scroll|hidden)["']/],
    ["overflow", /\boverflow:\s*["'](auto|scroll|hidden)["']/],
  ])("never wraps a table in a %s container — it would clip the card's shadow", (_name, pattern) => {
    // A window, not the single line. The first version of this guard checked
    // only the line holding <MaterialReactTable, and five pages had written the
    // wrapper on the line above — so it passed while the bug was still live on
    // Follow-ups, Users, Teams, Projects and Products. A wrapper is an ancestor;
    // ancestors are above you.
    const WINDOW = 4;
    const offenders = files.flatMap(([name, src]) => {
      const lines = src.split("\n");
      return lines.flatMap((line, i) => {
        if (!line.includes("<MaterialReactTable")) return [];
        const above = lines.slice(Math.max(0, i - WINDOW), i + 1);
        const hit = above.find((l) => pattern.test(l));
        return hit ? [`${name}: ${hit.trim()}`] : [];
      });
    });

    expect(offenders).toEqual([]);
  });
});
