import { describe, it, expect } from "vitest";
import { toPdfHtml, isBlankHtml, SUPPORTED_TAGS } from "./richTextHtml";

describe("toPdfHtml", () => {
  /**
   * REGRESSION, found by rendering a real PDF (2026-09-18). react-pdf-html
   * drops a tag it has no renderer for together with its text: Tiptap's
   * Highlight emits <mark>, and the highlighted sentence simply was not in the
   * PDF. No error, one console line. Unknown tags are unwrapped, never dropped.
   */
  it("keeps the words of a tag the PDF cannot draw", () => {
    expect(toPdfHtml("<p>Valid for <mark>15 days</mark> only</p>")).toBe("<p>Valid for 15 days only</p>");
  });

  it("unwraps nested unknowns and keeps the known formatting inside them", () => {
    expect(toPdfHtml("<div><section><p><strong>Bold</strong> <font>text</font></p></section></div>"))
      .toBe("<p><strong>Bold</strong> text</p>");
  });

  it("leaves everything the toolbar can produce untouched", () => {
    const html = '<h2 style="text-align: center;">T</h2><p><span style="color: rgb(185, 28, 28); font-size: 18px;">x</span> <u>u</u> <s>s</s> <em>e</em></p>'
      + "<ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol><blockquote><p>q</p></blockquote><hr>"
      + "<table><tbody><tr><th><p>h</p></th></tr><tr><td><p>d</p></td></tr></tbody></table>";
    expect(toPdfHtml(html)).toBe(html);
  });

  // Tiptap emits <colgroup><col> for every table; they carry no text and the
  // converter only logs about them.
  it("removes colgroup / col, script and style outright", () => {
    expect(toPdfHtml('<table><colgroup><col style="min-width: 25px;"></colgroup><tbody><tr><td><p>x</p></td></tr></tbody></table><script>alert(1)</script><style>p{}</style>'))
      .toBe("<table><tbody><tr><td><p>x</p></td></tr></tbody></table>");
  });

  it("keeps a safe link and unwraps an unsafe one", () => {
    expect(toPdfHtml('<p><a href="https://solarcare.in">site</a></p>')).toBe('<p><a href="https://solarcare.in">site</a></p>');
    expect(toPdfHtml('<p><a href="mailto:a@b.in">mail</a> <a href="tel:0792658">call</a></p>')).toContain('href="tel:0792658"');
    expect(toPdfHtml('<p><a href="javascript:alert(1)">click</a></p>')).toBe("<p>click</p>");
    expect(toPdfHtml("<p><a>bare</a></p>")).toBe("<p>bare</p>");
  });

  // A blank line in the editor is an empty <p>, which the PDF engine draws
  // zero-height — the spacing they typed would silently close up.
  it("gives an empty paragraph a non-breaking space so the blank line survives", () => {
    expect(toPdfHtml("<p>a</p><p></p><p>b</p>")).toBe("<p>a</p><p>&nbsp;</p><p>b</p>");
  });

  it("is an empty string for nothing", () => {
    expect(toPdfHtml("")).toBe("");
    expect(toPdfHtml(null)).toBe("");
    expect(toPdfHtml(42)).toBe("");
  });

  it("supports exactly the tags the renderer was seen drawing", () => {
    expect([...SUPPORTED_TAGS].sort()).toEqual(["a", "b", "blockquote", "br", "em", "h1", "h2", "h3", "hr", "i", "li", "ol", "p", "s", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "u", "ul"]);
  });
});

describe("isBlankHtml", () => {
  it.each([["", true], [null, true], ["<p></p>", true], ["<p>  </p><p><br></p>", true], ["<p>x</p>", false], ["<ul><li><p>a</p></li></ul>", false]])(
    "%p → %p", (html, blank) => expect(isBlankHtml(html)).toBe(blank),
  );
});
