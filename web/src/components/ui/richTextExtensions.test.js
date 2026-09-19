import { describe, it, expect, vi, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { renderHtml } from "react-pdf-html";
import { buildExtensions, COMMANDS } from "./richTextExtensions";
import { toPdfHtml, SUPPORTED_TAGS } from "./richTextHtml";

const run = (name, arg) => {
  const editor = new Editor({ element: null, extensions: buildExtensions(), content: "<p>Sample quotation text</p>" });
  editor.commands.selectAll();
  COMMANDS[name](editor.chain(), arg).run();
  const html = editor.getHTML();
  editor.destroy();
  return html;
};
const tagsIn = (html) => [...new Set([...html.matchAll(/<([a-z0-9]+)[\s>]/g)].map((m) => m[1]))];

afterEach(() => vi.restoreAllMocks());

/**
 * THE CLOSED-TOOLBAR GUARD.
 *
 * react-pdf-html drops a tag it cannot draw together with its text. This runs
 * every command the toolbar can issue through the REAL editor, then through the
 * REAL converter, and fails if the converter says it excluded anything, or if
 * the editor emitted a tag richTextHtml does not list. Whoever adds a toolbar
 * button adds it to COMMANDS, and finds out here — not from a customer holding
 * a quotation with a sentence missing.
 */
describe("every toolbar command survives the trip to the PDF", () => {
  it.each(Object.keys(COMMANDS))("%s", (name) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = toPdfHtml(run(name));
    renderHtml(html);
    const excluded = [...log.mock.calls, ...warn.mock.calls].map((c) => c.join(" ")).filter((m) => /Excluding/i.test(m));
    expect(excluded).toEqual([]);
    expect(tagsIn(html).filter((t) => !SUPPORTED_TAGS.has(t))).toEqual([]);
  });

  it("actually formats — the guard above is not passing on unchanged text", () => {
    expect(run("bold")).toBe("<p><strong>Sample quotation text</strong></p>");
    expect(run("highlight")).toContain("background-color");
    expect(run("highlight")).not.toContain("<mark");
    expect(run("fontSize", "18px")).toContain("font-size: 18px");
    expect(run("alignCenter")).toContain("text-align: center");
    expect(run("insertTable")).toContain("<table");
  });
});

describe("what is deliberately not installed", () => {
  const names = new Editor({ element: null, extensions: buildExtensions() }).extensionManager.extensions.map((e) => e.name);

  it.each(["highlight", "code", "codeBlock", "image"])("%s", (name) => expect(names).not.toContain(name));

  it("refuses a javascript: link", () => {
    expect(run("link", "javascript:alert(1)")).not.toContain("<a");
    expect(run("link", "https://solarcare.in")).toContain('href="https://solarcare.in"');
  });

  // Resizing writes widths onto <col>, which the PDF ignores — the customer
  // would get different columns than the agent drew.
  it("does not let table columns be resized", () => {
    expect(run("insertTable")).not.toMatch(/<col[^>]*\swidth/);
  });
});
