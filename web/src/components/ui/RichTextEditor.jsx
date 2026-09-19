import { useEffect, useId, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { useTheme } from "@mui/material/styles";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Bold, Highlighter, Italic, Link2, List,
  ListOrdered, Minus, Quote, Redo2, RemoveFormatting, Strikethrough, Table2, Underline, Undo2,
} from "lucide-react";

import IconButton from "./IconButton";
import Popover from "./Popover";
import { buildExtensions, COMMANDS, FONT_SIZES, HIGHLIGHTS, LINE_HEIGHTS, SWATCHES } from "./richTextExtensions";

const FONTS = [{ value: "Inter", label: "Sans" }, { value: "Noto Serif", label: "Serif" }];
const BLOCKS = [{ value: "paragraph", label: "Text" }, { value: "h1", label: "Heading 1" }, { value: "h2", label: "Heading 2" }, { value: "h3", label: "Heading 3" }];
const TABLE_ACTIONS = [
  ["insertTable", "Insert 3 × 3 table"], ["addRow", "Add row below"], ["addColumn", "Add column right"],
  ["toggleHeaderRow", "Toggle header row"], ["deleteRow", "Delete row"], ["deleteColumn", "Delete column"], ["deleteTable", "Delete table"],
];

/**
 * The one rich-text editor (Tiptap 3, headless — the toolbar is ours).
 *
 * `value` / `onChange` speak HTML; an editor with nothing visible in it reports
 * "" rather than "<p></p>", so a caller's "is this empty?" is a plain falsy test.
 *
 * What the toolbar offers is decided in richTextExtensions.js, not here, and is
 * a CLOSED list: this HTML is printed to PDF, and the converter drops whatever
 * it cannot draw — text included. Do not add a button without adding its
 * command there, where the guard test will check it survives.
 */
export default function RichTextEditor({
  value = "",
  onChange,
  label,
  hint,
  minHeight = 120,
  disabled = false,
  onEditorReady,
  "data-testid": testId = "rich-text",
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const labelId = useId();
  const [pop, setPop] = useState(null); // { kind: 'color' | 'highlight' | 'link' | 'table', anchor }
  const [href, setHref] = useState("");

  // The editor emits an update on MOUNT (its plugins normalise the document),
  // echoing back the value it was just given. Reporting that as a change would
  // open every quotation already "unsaved". A change is only a change when the
  // HTML differs from what the parent last handed us.
  const latest = useRef(value || "");
  latest.current = value || "";

  const editor = useEditor({
    extensions: buildExtensions(),
    content: value || "",
    editable: !disabled,
    // v3 no longer re-renders React on every transaction; the toolbar's active
    // states need it. These editors hold a paragraph or two — it is cheap.
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { role: "textbox", "aria-multiline": "true", "aria-labelledby": labelId } },
    onUpdate: ({ editor: ed }) => {
      const html = ed.isEmpty ? "" : ed.getHTML();
      if (html !== latest.current) onChange?.(html);
    },
  });

  useEffect(() => { if (editor) onEditorReady?.(editor); }, [editor, onEditorReady]);
  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);

  // The parent owns the value (a revision loads, a template default is applied).
  // Only push it in when it genuinely differs, or every keystroke would reset
  // the caret to the end.
  useEffect(() => {
    if (!editor) return;
    const current = editor.isEmpty ? "" : editor.getHTML();
    if ((value || "") !== current) editor.commands.setContent(value || "", { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return null;

  const run = (name, arg) => COMMANDS[name](editor.chain().focus(), arg).run();
  const open = (kind) => (e) => {
    if (kind === "link") setHref(editor.getAttributes("link").href ?? "");
    setPop({ kind, anchor: e.currentTarget });
  };
  const close = () => setPop(null);

  const btn = (name, Icon, title, active = editor.isActive(name)) => (
    <IconButton key={name} size="sm" variant={active ? "tonal" : "ghost"} aria-label={title} aria-pressed={active}
      tooltip={title} disabled={disabled} onClick={() => run(name)} data-testid={`${testId}-${name}`}>
      <Icon size={15} />
    </IconButton>
  );
  const align = (name, Icon, title, dir) => btn(name, Icon, title, editor.isActive({ textAlign: dir }));

  // ponytail: native <select>s. A Combobox is an Autocomplete with a popper and
  // a text field; for "pick one of eight sizes" in a toolbar that is a lot of
  // machinery, and the native control is keyboard- and screen-reader-complete.
  const selectStyle = {
    height: 28, borderRadius: theme.radii.sm, border: `1px solid ${p.border.default}`, background: p.surface.card,
    color: p.text.primary, fontSize: 12, fontFamily: p.fontFamilies.sans, padding: "0 6px",
  };
  const block = BLOCKS.find((b) => (b.value === "paragraph" ? false : editor.isActive("heading", { level: Number(b.value[1]) })))?.value ?? "paragraph";
  const ts = editor.getAttributes("textStyle");
  const sep = <span aria-hidden style={{ width: 1, alignSelf: "stretch", background: p.border.default, margin: "2px 4px" }} />;

  const swatch = (color, onPick) => (
    <button key={color} type="button" aria-label={color} onClick={() => { onPick(color); close(); }}
      style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${p.border.strong}`, background: color, cursor: "pointer" }} />
  );

  return (
    <div data-testid={testId} style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: p.fontFamilies.sans }}>
      {label && <span id={labelId} style={{ fontSize: 13, fontWeight: 500, color: p.text.secondary }}>{label}</span>}
      <div style={{ border: `1px solid ${p.border.default}`, borderRadius: theme.radii.md, background: p.surface.card, overflow: "hidden", opacity: disabled ? 0.7 : 1 }}>
        <div role="toolbar" aria-label="Formatting" data-testid={`${testId}-toolbar`}
          style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2, padding: 4, borderBottom: `1px solid ${p.border.default}`, background: p.surface.subtle }}>
          <select aria-label="Block style" value={block} disabled={disabled} style={selectStyle} onChange={(e) => run(e.target.value)} data-testid={`${testId}-block`}>
            {BLOCKS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
          <select aria-label="Font" value={ts.fontFamily ?? "Inter"} disabled={disabled} style={selectStyle} onChange={(e) => run("fontFamily", e.target.value)} data-testid={`${testId}-font`}>
            {FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <select aria-label="Size" value={ts.fontSize ?? "10px"} disabled={disabled} style={selectStyle} onChange={(e) => run("fontSize", e.target.value)} data-testid={`${testId}-size`}>
            {FONT_SIZES.map((s) => <option key={s} value={s}>{parseInt(s, 10)}</option>)}
          </select>
          {sep}
          {btn("bold", Bold, "Bold")}{btn("italic", Italic, "Italic")}{btn("underline", Underline, "Underline")}{btn("strike", Strikethrough, "Strikethrough")}
          <IconButton size="sm" variant="ghost" aria-label="Text colour" tooltip="Text colour" disabled={disabled} onClick={open("color")} data-testid={`${testId}-color`}>
            <Baseline size={15} color={ts.color ?? undefined} />
          </IconButton>
          <IconButton size="sm" variant={ts.backgroundColor ? "tonal" : "ghost"} aria-label="Highlight" tooltip="Highlight" disabled={disabled} onClick={open("highlight")} data-testid={`${testId}-highlight`}>
            <Highlighter size={15} />
          </IconButton>
          {sep}
          {align("alignLeft", AlignLeft, "Align left", "left")}{align("alignCenter", AlignCenter, "Centre", "center")}
          {align("alignRight", AlignRight, "Align right", "right")}{align("alignJustify", AlignJustify, "Justify", "justify")}
          <select aria-label="Line spacing" value={ts.lineHeight ?? "1.5"} disabled={disabled} style={selectStyle} onChange={(e) => run("lineHeight", e.target.value)} data-testid={`${testId}-leading`}>
            {LINE_HEIGHTS.map((l) => <option key={l} value={l}>{l}×</option>)}
          </select>
          {sep}
          {btn("bulletList", List, "Bulleted list")}{btn("orderedList", ListOrdered, "Numbered list")}{btn("blockquote", Quote, "Quote")}
          {btn("divider", Minus, "Divider", false)}
          <IconButton size="sm" variant={editor.isActive("link") ? "tonal" : "ghost"} aria-label="Link" tooltip="Link" disabled={disabled} onClick={open("link")} data-testid={`${testId}-link`}><Link2 size={15} /></IconButton>
          <IconButton size="sm" variant={editor.isActive("table") ? "tonal" : "ghost"} aria-label="Table" tooltip="Table" disabled={disabled} onClick={open("table")} data-testid={`${testId}-table`}><Table2 size={15} /></IconButton>
          {sep}
          {btn("clearFormatting", RemoveFormatting, "Clear formatting", false)}{btn("undo", Undo2, "Undo", false)}{btn("redo", Redo2, "Redo", false)}
        </div>
        <EditorContent editor={editor} className="rte-content"
          style={{ minHeight, padding: "10px 12px", fontSize: 14, lineHeight: 1.5, color: p.text.primary, cursor: "text" }}
          onClick={() => editor.chain().focus().run()} />
      </div>
      {hint && <span style={{ fontSize: 12, color: p.text.tertiary }}>{hint}</span>}

      <Popover open={pop?.kind === "color" || pop?.kind === "highlight"} anchorEl={pop?.anchor} onClose={close} data-testid={`${testId}-swatches`}>
        <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, width: 176 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(pop?.kind === "highlight" ? HIGHLIGHTS : SWATCHES).map((c) => swatch(c, (v) => run(pop.kind, v)))}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            {/* The platform's own picker — no colour-picker dependency for "any colour". */}
            <input type="color" aria-label="Custom colour" style={{ width: 36, height: 26, padding: 0, border: "none", background: "none" }}
              onChange={(e) => run(pop.kind, e.target.value)} data-testid={`${testId}-custom-colour`} />
            <button type="button" style={{ ...selectStyle, cursor: "pointer" }} onClick={() => { run(pop.kind === "highlight" ? "unsetHighlight" : "unsetColor"); close(); }}>None</button>
          </div>
        </div>
      </Popover>

      <Popover open={pop?.kind === "link"} anchorEl={pop?.anchor} onClose={close} data-testid={`${testId}-link-pop`}>
        {/* MUI caps a popover's paper at `calc(100% - 32px)` and clips its
            overflow-x, so this row's 356px (a fixed 220px input + Apply +
            Remove + padding) lost its Remove button at 360px — you could add
            a link on a small phone but never clear one. Wrap, and let the
            input be fluid. */}
        <form style={{ padding: 10, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", maxWidth: 300 }}
          onSubmit={(e) => { e.preventDefault(); if (href.trim()) run("link", href.trim()); else run("unlink"); close(); }}>
          <input aria-label="Link address" value={href} onChange={(e) => setHref(e.target.value)} placeholder="https://" autoFocus
            style={{ ...selectStyle, width: "100%", height: 30 }} data-testid={`${testId}-href`} />
          <button type="submit" style={{ ...selectStyle, cursor: "pointer" }}>Apply</button>
          <button type="button" style={{ ...selectStyle, cursor: "pointer" }} onClick={() => { run("unlink"); close(); }}>Remove</button>
        </form>
      </Popover>

      <Popover open={pop?.kind === "table"} anchorEl={pop?.anchor} onClose={close} data-testid={`${testId}-table-pop`}>
        <div style={{ padding: 6, display: "flex", flexDirection: "column", minWidth: 190 }}>
          {TABLE_ACTIONS.map(([name, text]) => (
            <button key={name} type="button" disabled={name !== "insertTable" && !editor.isActive("table")}
              style={{ ...selectStyle, border: "none", background: "none", textAlign: "left", height: 30, cursor: "pointer" }}
              onClick={() => { run(name); close(); }} data-testid={`${testId}-${name}`}>{text}</button>
          ))}
        </div>
      </Popover>
    </div>
  );
}
