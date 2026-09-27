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
  it("lifts form controls to 16px on touch screens, in both orientations", () => {
    // 1024, not the phone breakpoint: every modern phone in LANDSCAPE is
    // 667-932px wide and still a coarse pointer, so a narrower query let the
    // zoom back in the moment the user rotated.
    const block = indexCss.slice(
      indexCss.indexOf("@media (pointer: coarse) and (max-width: 1024px)"),
    );
    expect(block).toMatch(/^@media \(pointer: coarse\) and \(max-width: 1024px\)/);
    // TextInput sets its size as an inline style, so only !important wins.
    expect(block).toMatch(/input, select, textarea \{ font-size: 16px !important; \}/);
  });

  // x-date-pickers v9 renders NO <input> — the field is a
  // MuiPickersInputBase-root wrapping contenteditable <span> sections — so the
  // input selector cannot reach it, and ui/DateField pins those spans with its
  // own !important. This was the largest hole in the first version of the fix.
  it("reaches the date fields and the rich-text surface too", () => {
    const block = indexCss.slice(
      indexCss.indexOf("@media (pointer: coarse) and (max-width: 1024px)"),
    );
    expect(block).toMatch(/MuiPickersSectionList-section/);
    expect(block).toMatch(/\.rte-content \.tiptap \{ font-size: 16px; \}/);
  });

  // Unlayered on purpose: when two declarations are both !important, layer
  // order is REVERSED, so a rule inside @layer base would lose to the
  // unlayered !important that emotion injects.
  it("sits outside @layer base, or it would lose the cascade", () => {
    const layerBase = indexCss.slice(
      indexCss.indexOf("@layer base {"),
      indexCss.indexOf("Scrollbar"),
    );
    expect(layerBase).not.toMatch(/pointer: coarse/);
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
