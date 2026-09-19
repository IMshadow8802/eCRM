import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import RichTextEditor from "./RichTextEditor";

// The component reads theme.tokens; MUI's default theme has none.
const themed = (ui) => <ThemeProvider theme={buildTheme("light")}>{ui}</ThemeProvider>;

// jsdom cannot take keystrokes into a contenteditable, so tests select through
// the editor instance (onEditorReady) and then press the REAL toolbar buttons.
// Controlled, like every real caller: the editor only reports HTML that differs
// from the value it was last handed, so a harness that never feeds the value
// back would see "undo the colour" as no change at all.
function Controlled({ initial, onChange, ...rest }) {
  const [value, setValue] = useState(initial);
  return <RichTextEditor label="Message" value={value} onChange={(html) => { setValue(html); onChange(html); }} {...rest} />;
}

function setup({ value = "<p>Dear customer</p>", ...props } = {}) {
  let editor;
  const onChange = vi.fn();
  const utils = render(themed(<Controlled initial={value} onChange={onChange} onEditorReady={(e) => { editor = e; }} {...props} />));
  const selectAll = () => act(() => { editor.commands.selectAll(); });
  return { ...utils, onChange, selectAll, get editor() { return editor; } };
}
const last = (fn) => fn.mock.calls.at(-1)[0];

describe("RichTextEditor", () => {
  it("shows the value, labelled, with a formatting toolbar", () => {
    setup();
    expect(screen.getByText("Dear customer")).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    expect(screen.getByRole("textbox").getAttribute("aria-labelledby")).toBe(screen.getByText("Message").id);
  });

  it.each([
    ["rich-text-bold", "<strong>"], ["rich-text-italic", "<em>"], ["rich-text-underline", "<u>"], ["rich-text-strike", "<s>"],
    ["rich-text-alignCenter", "text-align: center"], ["rich-text-bulletList", "<ul>"], ["rich-text-orderedList", "<ol>"], ["rich-text-blockquote", "<blockquote>"],
  ])("%s formats the selection and reports HTML", (testId, expected) => {
    const t = setup();
    t.selectAll();
    fireEvent.click(screen.getByTestId(testId));
    expect(last(t.onChange)).toContain(expected);
  });

  it("marks an active format as pressed", () => {
    const t = setup({ value: "<p><strong>Bold already</strong></p>" });
    t.selectAll();
    expect(screen.getByTestId("rich-text-bold").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("rich-text-italic").getAttribute("aria-pressed")).toBe("false");
  });

  it("changes block style, font and size from the selects", () => {
    const t = setup();
    t.selectAll();
    fireEvent.change(screen.getByTestId("rich-text-block"), { target: { value: "h2" } });
    expect(last(t.onChange)).toContain("<h2>");
    fireEvent.change(screen.getByTestId("rich-text-size"), { target: { value: "18px" } });
    expect(last(t.onChange)).toContain("font-size: 18px");
    fireEvent.change(screen.getByTestId("rich-text-font"), { target: { value: "Noto Serif" } });
    expect(last(t.onChange)).toContain("Noto Serif");
    fireEvent.change(screen.getByTestId("rich-text-leading"), { target: { value: "2" } });
    expect(last(t.onChange)).toContain("line-height: 2");
  });

  it("colours text from a swatch, and clears it with None", () => {
    const t = setup();
    t.selectAll();
    fireEvent.click(screen.getByTestId("rich-text-color"));
    fireEvent.click(screen.getByLabelText("#b91c1c"));
    expect(last(t.onChange)).toMatch(/color: (rgb\(185, 28, 28\)|#b91c1c)/);
    t.selectAll();
    fireEvent.click(screen.getByTestId("rich-text-color"));
    fireEvent.click(screen.getByText("None"));
    expect(last(t.onChange)).toBe("<p>Dear customer</p>");
  });

  // Highlight must be a styled <span>. Tiptap's own Highlight emits <mark>,
  // which the PDF converter drops together with the highlighted words.
  it("highlights with a background colour, never a <mark>", () => {
    const t = setup();
    t.selectAll();
    fireEvent.click(screen.getByTestId("rich-text-highlight"));
    fireEvent.click(screen.getByLabelText("#fde68a"));
    expect(last(t.onChange)).toContain("background-color");
    expect(last(t.onChange)).not.toContain("<mark");
  });

  // The "None" button is shared by the colour and highlight popovers — a
  // ternary on pop.kind picks unsetColor vs unsetHighlight. The colour side
  // is covered above; this is the highlight side.
  it("clears a highlight with None", () => {
    const t = setup();
    t.selectAll();
    fireEvent.click(screen.getByTestId("rich-text-highlight"));
    fireEvent.click(screen.getByLabelText("#fde68a"));
    expect(last(t.onChange)).toContain("background-color");
    t.selectAll();
    fireEvent.click(screen.getByTestId("rich-text-highlight"));
    fireEvent.click(screen.getByText("None"));
    expect(last(t.onChange)).toBe("<p>Dear customer</p>");
  });

  it("takes any colour from the native picker", () => {
    const t = setup();
    t.selectAll();
    fireEvent.click(screen.getByTestId("rich-text-color"));
    fireEvent.change(screen.getByTestId("rich-text-custom-colour"), { target: { value: "#123456" } });
    expect(last(t.onChange)).toMatch(/color: (rgb\(18, 52, 86\)|#123456)/);
  });

  it("adds a link, refuses a javascript: one, and removes it", () => {
    const t = setup();
    t.selectAll();
    fireEvent.click(screen.getByTestId("rich-text-link"));
    fireEvent.change(screen.getByTestId("rich-text-href"), { target: { value: "https://solarcare.in" } });
    fireEvent.click(screen.getByText("Apply"));
    expect(last(t.onChange)).toContain('href="https://solarcare.in"');

    t.selectAll();
    fireEvent.click(screen.getByTestId("rich-text-link"));
    expect(screen.getByTestId("rich-text-href").value).toBe("https://solarcare.in"); // editing, not starting over
    fireEvent.click(screen.getByText("Remove"));
    expect(last(t.onChange)).not.toContain("<a");

    t.selectAll();
    fireEvent.click(screen.getByTestId("rich-text-link"));
    fireEvent.change(screen.getByTestId("rich-text-href"), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByText("Apply"));
    expect(last(t.onChange)).not.toContain("<a");
  });

  // The form's onSubmit branches on href.trim(): a non-blank address runs
  // "link", a blank one runs "unlink" implicitly — distinct from clicking the
  // explicit "Remove" button above.
  it("submitting the link form with a blank address removes the link", () => {
    const t = setup();
    t.selectAll();
    fireEvent.click(screen.getByTestId("rich-text-link"));
    fireEvent.change(screen.getByTestId("rich-text-href"), { target: { value: "https://solarcare.in" } });
    fireEvent.click(screen.getByText("Apply"));
    expect(last(t.onChange)).toContain('href="https://solarcare.in"');

    t.selectAll();
    fireEvent.click(screen.getByTestId("rich-text-link"));
    fireEvent.change(screen.getByTestId("rich-text-href"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Apply"));
    expect(last(t.onChange)).not.toContain("<a");
  });

  it("inserts a table; row and column actions wake up only inside one", () => {
    const t = setup();
    fireEvent.click(screen.getByTestId("rich-text-table"));
    expect(screen.getByTestId("rich-text-addRow").disabled).toBe(true);
    fireEvent.click(screen.getByTestId("rich-text-insertTable"));
    expect(last(t.onChange)).toContain("<table");
    expect((last(t.onChange).match(/<tr>/g) ?? []).length).toBe(3);
    fireEvent.click(screen.getByTestId("rich-text-table"));
    fireEvent.click(screen.getByTestId("rich-text-addRow"));
    expect((last(t.onChange).match(/<tr>/g) ?? []).length).toBe(4);
  });

  // "<p></p>" is what an emptied editor holds. Callers test `if (!html)`.
  it('reports "" — not "<p></p>" — when emptied', () => {
    const t = setup();
    act(() => { t.editor.commands.clearContent(true); });
    expect(last(t.onChange)).toBe("");
  });

  // REGRESSION (caught in the spike, 2026-09-18): Tiptap emits an update on
  // mount, echoing the value it was given. Every quotation would have opened
  // already marked "unsaved".
  it("does not report a change just for being mounted", () => {
    const t = setup();
    expect(t.onChange).not.toHaveBeenCalled();
  });

  it("takes a new value from the parent without echoing it back as a change", () => {
    const onChange = vi.fn();
    const { rerender } = render(themed(<RichTextEditor label="Message" value="<p>Dear customer</p>" onChange={onChange} />));
    rerender(themed(<RichTextEditor label="Message" value="<p>Revision 2</p>" onChange={onChange} />));
    expect(screen.getByText("Revision 2")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("locks the text and the toolbar when disabled", () => {
    setup({ disabled: true });
    expect(screen.getByRole("textbox").getAttribute("contenteditable")).toBe("false");
    expect(screen.getByTestId("rich-text-bold").disabled).toBe(true);
    expect(screen.getByTestId("rich-text-block").disabled).toBe(true);
  });

  it("shows a hint", () => {
    setup({ hint: "Shown above the price table" });
    expect(screen.getByText("Shown above the price table")).toBeTruthy();
  });

  // Regression, 2026-09-19: the link form was a non-wrapping row holding a
  // fixed 220px input plus Apply plus Remove — about 356px. MUI's popover
  // paper is capped at `calc(100% - 32px)` and clips its overflow-x, so at
  // 360px the Remove button was sliced off with no way to scroll to it: you
  // could add a link on a small phone but never clear one.
  it("wraps the link form so Remove survives a 360px popover", () => {
    render(themed(<Controlled initial="<p>x</p>" onChange={() => {}} />));
    fireEvent.click(screen.getByTestId("rich-text-link"));
    const input = screen.getByTestId("rich-text-href");
    const form = input.closest("form");
    expect(form.style.flexWrap).toBe("wrap");
    expect(form.style.maxWidth).toBe("300px");
    // Fluid, not a fixed 220 that cannot give way.
    expect(input.style.width).toBe("100%");
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });
});
