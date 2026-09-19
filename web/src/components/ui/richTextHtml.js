// Editor HTML → HTML the PDF converter can draw.
//
// react-pdf-html drops any tag it has no renderer for TOGETHER WITH ITS TEXT —
// found the hard way (2026-09-18): Tiptap's Highlight emits <mark>, and the
// highlighted sentence simply vanished from the PDF, no error. The toolbar is a
// closed list so the editor never emits one, but stored HTML outlives the
// toolbar that made it, and a pasted document can carry anything. So before the
// converter sees it: an unknown element is UNWRAPPED (its children stay), never
// dropped. Worst case is lost formatting, never lost words.

export const SUPPORTED_TAGS = new Set([
  "p", "span", "strong", "em", "u", "s", "b", "i", "br", "hr",
  "h1", "h2", "h3", "ul", "ol", "li", "blockquote", "a",
  "table", "thead", "tbody", "tr", "th", "td",
]);
// Carry no text; the converter only logs about them.
const DROP_TAGS = new Set(["colgroup", "col", "script", "style"]);

const SAFE_HREF = /^(https?:|mailto:|tel:)/i;

export function toPdfHtml(html) {
  if (!html || typeof html !== "string") return "";
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

  const walk = (node) => {
    for (const child of [...node.children]) {
      const tag = child.tagName.toLowerCase();
      if (DROP_TAGS.has(tag)) { child.remove(); continue; }
      walk(child);
      if (!SUPPORTED_TAGS.has(tag)) { child.replaceWith(...child.childNodes); continue; }
      if (tag === "a" && !SAFE_HREF.test(child.getAttribute("href") ?? "")) child.replaceWith(...child.childNodes);
      // A blank line in the editor is an empty <p>, which the PDF engine draws
      // zero-height: the spacing they typed would silently close up.
      if (tag === "p" && !child.textContent && !child.children.length) child.textContent = " ";
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/** True when the editor holds nothing a reader would see. */
export const isBlankHtml = (html) =>
  !html || !new DOMParser().parseFromString(html, "text/html").body.textContent.trim();
