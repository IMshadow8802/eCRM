// A test double for @react-pdf/renderer (and react-pdf-html).
//
// jsdom cannot run the real renderer — it lays out and paints a PDF. What a
// unit test CAN check is what a template decided to print: is there an IGST
// row, is the GST column gone for an unregistered seller, is DRAFT stamped on
// a draft. So each primitive becomes a plain DOM element and RTL reads the text.
// What the PDF actually LOOKS like is checked by eye in the live pass.
//
//   vi.mock("@react-pdf/renderer", () => import("<rel>/test/reactPdfMock"));
//   vi.mock("react-pdf-html", async () => ({ default: (await import("<rel>/test/reactPdfMock")).Html }));
import { vi } from "vitest";

// This file is a test double, never rendered by the dev server, so the
// fast-refresh rule about mixing components and constants cannot apply to it.
/* eslint-disable react-refresh/only-export-components */

export const Document = ({ children, title }) => <div data-pdf="document" data-title={title}>{children}</div>;
export const Page = ({ children }) => <section data-pdf="page">{children}</section>;
export const View = ({ children, fixed, wrap }) => (
  <div data-pdf="view" data-fixed={fixed ? "" : undefined} data-wrap={wrap === false ? "false" : undefined}>{children}</div>
);
export const Text = ({ children, render }) => <span data-pdf="text">{render ? render({ pageNumber: 1, totalPages: 1 }) : children}</span>;
export const Image = ({ src }) => <img data-pdf="image" src={src} alt="" />;
export const StyleSheet = { create: (styles) => styles };
export const Font = { register: vi.fn(), registerHyphenationCallback: vi.fn() };

/** react-pdf-html's <Html>: the HTML string, as text. Enough to assert it was handed over. */
export const Html = ({ children }) => <div data-pdf="html">{children}</div>;

/** usePDF → [instance, update]. Tests reach the spies through `usePDF.update`. */
export const usePDF = vi.fn(() => [{ loading: false, url: "blob:preview", blob: new Blob(["pdf"]), error: null }, usePDF.update]);
usePDF.update = vi.fn();
