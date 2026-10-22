// Which of the six pastel faces (tokens `cardFace.faces`) a card wears.
// A string hash of the id, so a card keeps its colour across pages and reloads.
export function faceIndex(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h) % 6;
}

// The one way to reach them shown on a tile: first mobile, else landline,
// else email; `more` = how many others of that kind (numbers count together).
export function mainContact({ mobiles = [], landlines = [], emails = [] }) {
  const numbers = [...mobiles, ...landlines];
  const list = numbers.length ? numbers : emails;
  return { main: list[0] || "", more: Math.max(0, list.length - 1) };
}

// Business name, else the person; the person line only when the name is the business.
export const cardName = (c) => c.businessName || c.contactPerson || "";
export const cardPerson = (c) => [c.businessName && c.contactPerson, c.designation].filter(Boolean).join(" · ");
