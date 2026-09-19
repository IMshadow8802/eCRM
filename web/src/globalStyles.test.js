import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { fontFamilies } from "./styles/tokens";

const read = (rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const indexCss = read("./index.css");
const indexHtml = read("../index.html");

describe("global stylesheet", () => {
  // Regression, 2026-09-19: every control in the app is 13-15px (ui/TextInput
  // SIZE, typoTokens.body), and iOS Safari zooms the page in whenever a
  // focused control computes below 16px. The zoom left the layout wider than
  // the screen, so a user had to pinch back out after every field — on every
  // screen in the app that has an input.
  it("lifts form controls to 16px on small touch screens", () => {
    const rule = indexCss.match(
      /@media \(pointer: coarse\) and \(max-width: 767\.98px\) \{[^}]*\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule[0]).toMatch(/input, select, textarea/);
    // TextInput sets its size as an inline style, so only !important wins.
    expect(rule[0]).toMatch(/font-size: 16px !important/);
  });

  it("leaves desktop density alone", () => {
    // The guard is the media query: no unconditional 16px override.
    const base = indexCss.replace(/@media[^{]*\{(?:[^{}]|\{[^}]*\})*\}/g, "");
    expect(base).not.toMatch(/font-size: 16px !important/);
  });
});

describe("index.html", () => {
  // Regression, 2026-09-19: the page pulled five weights of Poppins from
  // Google Fonts on every cold load — render-blocking, and Poppins appears
  // nowhere in src/. The app has used self-hosted Inter since the token
  // switch (@fontsource imports in index.css).
  it("fetches no remote fonts", () => {
    expect(indexHtml).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  });

  it("keeps the self-hosted family the tokens actually name", () => {
    expect(fontFamilies.sans).toMatch(/^'Inter'/);
    expect(indexCss).toMatch(/@import '@fontsource\/inter\/400\.css'/);
  });

  it("still declares the responsive viewport", () => {
    expect(indexHtml).toMatch(
      /<meta name="viewport" content="width=device-width, initial-scale=1\.0" \/>/,
    );
  });
});
