// The three shipped templates. Adding one is a file plus a line here.
//
// A TEMPLATE IS NEVER REDESIGNED IN PLACE. A finalised quotation re-renders from
// its TemplateCode for as long as it exists, so changing `modern` changes every
// quotation ever issued on it — including ones a customer is holding. A breaking
// redesign ships under a new code; the old one stays, unlisted if need be.
import Classic from "./classic";
import Modern from "./modern";
import Minimal from "./minimal";

export const TEMPLATES = [
  { code: "classic", name: "Classic", blurb: "Formal letterhead. The safe choice for an accounts department.", Component: Classic },
  { code: "modern", name: "Modern", blurb: "A colour band, a banner image, bold totals.", Component: Modern },
  { code: "minimal", name: "Minimal", blurb: "Hairlines and air. The colour appears twice.", Component: Minimal },
];

export const templateByCode = (code) => TEMPLATES.find((t) => t.code === code) ?? TEMPLATES[0];
