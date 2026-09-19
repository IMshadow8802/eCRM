// Fonts the PDF can draw. Every family needs ALL FOUR faces: the renderer
// throws ("Could not resolve font…") the moment bold-italic text meets a family
// that registered no bold-italic. The 14 built-in PDF fonts are not offered at
// all — none of them has the rupee sign (U+20B9).
import { Font } from "@react-pdf/renderer";

export const FONT_FAMILIES = [
  { value: "Inter", label: "Inter (sans)" },
  { value: "Noto Serif", label: "Noto Serif" },
];

const FACES = ["regular", "italic", "bold", "boldItalic"];

let registered = false;

/** @param sources { Inter: { regular, italic, bold, boldItalic }, "Noto Serif": {…} } — URLs (app) or file paths (node) */
export function registerFonts(sources) {
  if (registered) return;
  // Check every family BEFORE registering any: a missing face would register as
  // `src: undefined` and only blow up when text of that weight is laid out.
  for (const [family, f] of Object.entries(sources)) {
    const missing = FACES.filter((face) => !f?.[face]);
    if (missing.length) throw new Error(`Font "${family}" is missing ${missing.join(", ")} — a family needs all four faces`);
  }
  for (const [family, f] of Object.entries(sources)) {
    Font.register({
      family,
      fonts: [
        { src: f.regular },
        { src: f.italic, fontStyle: "italic" },
        { src: f.bold, fontWeight: 700 },
        { src: f.boldItalic, fontWeight: 700, fontStyle: "italic" },
      ],
    });
  }
  // The engine hyphenates English by default and breaks "quo-tation" across
  // lines in a narrow table cell. Whole words only.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
