// What the editor can do — and therefore what the toolbar may offer.
//
// THE TOOLBAR IS A CLOSED LIST, and this file is the list. Rich text here ends
// up in a PDF through react-pdf-html, which drops any tag it has no renderer
// for TOGETHER WITH ITS TEXT (found 2026-09-18: Tiptap's Highlight emits
// <mark>, and the highlighted sentence was simply not in the PDF). So:
//   * highlight is BackgroundColor from TextStyleKit — a styled <span>, which
//     draws — and the Highlight extension is never installed;
//   * code / codeBlock are off (<code>, <pre>);
//   * tables are not resizable: resizing writes widths onto <col>, which the
//     PDF ignores, so the customer would get different columns than they drew;
//   * no image node: the attachment endpoint needs a JWT an <img src> cannot
//     send. Pictures live in the quotation's picture sections.
// richTextExtensions.test.js drives every command below through the real
// converter and fails on any tag it would drop. Add a feature there first.
import { StarterKit } from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { TextAlign } from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";

export const FONT_SIZES = ["9px", "10px", "11px", "12px", "14px", "16px", "18px", "24px"];
export const LINE_HEIGHTS = ["1", "1.25", "1.5", "1.8", "2"];
export const SWATCHES = ["#0f172a", "#475569", "#b91c1c", "#c2410c", "#a16207", "#15803d", "#0f766e", "#1d4ed8", "#6d28d9", "#be185d"];
export const HIGHLIGHTS = ["#fde68a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#e2e8f0"];

export const buildExtensions = () => [
  StarterKit.configure({
    code: false,
    codeBlock: false,
    heading: { levels: [1, 2, 3] },
    // Tiptap itself refuses a javascript: href; this narrows it to what a
    // quotation can sensibly link to.
    link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto", "tel"] },
  }),
  TextStyleKit,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  TableKit.configure({ table: { resizable: false } }),
];

/** Every toolbar action, by name → a chain step. The guard test walks this map. */
export const COMMANDS = {
  bold: (c) => c.toggleBold(),
  italic: (c) => c.toggleItalic(),
  underline: (c) => c.toggleUnderline(),
  strike: (c) => c.toggleStrike(),
  color: (c, v = "#b91c1c") => c.setColor(v),
  unsetColor: (c) => c.unsetColor(),
  highlight: (c, v = "#fde68a") => c.setBackgroundColor(v),
  unsetHighlight: (c) => c.unsetBackgroundColor(),
  fontSize: (c, v = "18px") => c.setFontSize(v),
  fontFamily: (c, v = "Noto Serif") => c.setFontFamily(v),
  lineHeight: (c, v = "1.8") => c.setLineHeight(v),
  alignLeft: (c) => c.setTextAlign("left"),
  alignCenter: (c) => c.setTextAlign("center"),
  alignRight: (c) => c.setTextAlign("right"),
  alignJustify: (c) => c.setTextAlign("justify"),
  paragraph: (c) => c.setParagraph(),
  h1: (c) => c.toggleHeading({ level: 1 }),
  h2: (c) => c.toggleHeading({ level: 2 }),
  h3: (c) => c.toggleHeading({ level: 3 }),
  bulletList: (c) => c.toggleBulletList(),
  orderedList: (c) => c.toggleOrderedList(),
  blockquote: (c) => c.toggleBlockquote(),
  divider: (c) => c.setHorizontalRule(),
  link: (c, v = "https://example.com") => c.extendMarkRange("link").setLink({ href: v }),
  unlink: (c) => c.unsetLink(),
  insertTable: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
  addRow: (c) => c.addRowAfter(),
  addColumn: (c) => c.addColumnAfter(),
  deleteRow: (c) => c.deleteRow(),
  deleteColumn: (c) => c.deleteColumn(),
  toggleHeaderRow: (c) => c.toggleHeaderRow(),
  deleteTable: (c) => c.deleteTable(),
  clearFormatting: (c) => c.unsetAllMarks().clearNodes(),
  undo: (c) => c.undo(),
  redo: (c) => c.redo(),
};
