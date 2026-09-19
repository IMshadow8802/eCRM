import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@react-pdf/renderer", () => import("../../../../test/reactPdfMock"));

const FACES = { regular: "r.ttf", italic: "i.ttf", bold: "b.ttf", boldItalic: "bi.ttf" };

// registerFonts guards itself with a module-level flag, so each test takes a
// fresh copy of the module (and of the mocked Font it registers against).
//
// Sequential, not Promise.all: firing both dynamic imports in the same tick
// races vi.mock's factory for "@react-pdf/renderer" after resetModules() —
// each import can independently see "not cached yet" and re-run the factory,
// so ./fonts ends up registering against a different Font object than the one
// this helper hands back to the test. Awaiting ./fonts first lets its nested
// import of "@react-pdf/renderer" populate the cache before we read it.
const load = async () => {
  vi.resetModules();
  const fonts = await import("./fonts");
  const pdf = await import("@react-pdf/renderer");
  pdf.Font.register.mockClear();
  pdf.Font.registerHyphenationCallback.mockClear();
  return { ...fonts, Font: pdf.Font };
};

describe("registerFonts", () => {
  it("registers every family with all four faces", async () => {
    const { registerFonts, Font } = await load();
    registerFonts({ Inter: FACES, "Noto Serif": FACES });

    expect(Font.register).toHaveBeenCalledTimes(2);
    expect(Font.register.mock.calls.map(([a]) => a.family)).toEqual(["Inter", "Noto Serif"]);
    for (const [arg] of Font.register.mock.calls) {
      expect(arg.fonts).toEqual([
        { src: "r.ttf" },
        { src: "i.ttf", fontStyle: "italic" },
        { src: "b.ttf", fontWeight: 700 },
        { src: "bi.ttf", fontWeight: 700, fontStyle: "italic" },
      ]);
    }
    // Whole words only — the engine otherwise breaks "quo-tation" in a cell.
    const [hyphenate] = Font.registerHyphenationCallback.mock.calls[0];
    expect(hyphenate("quotation")).toEqual(["quotation"]);
  });

  it("registers once, however often it is called", async () => {
    const { registerFonts, Font } = await load();
    registerFonts({ Inter: FACES });
    registerFonts({ Inter: FACES });
    expect(Font.register).toHaveBeenCalledTimes(1);
  });

  /**
   * A missing face registers `src: undefined` and the renderer throws the first
   * time bold-italic text meets that family — far from the cause. Refuse the
   * whole call instead, before anything is registered.
   */
  it("rejects a family missing a face rather than half-registering it", async () => {
    const { registerFonts, Font } = await load();
    expect(() => registerFonts({ Inter: FACES, "Noto Serif": { regular: "r.ttf", bold: "b.ttf" } }))
      .toThrow(/Noto Serif.*italic/i);
    expect(Font.register).not.toHaveBeenCalled();
  });

  it("offers exactly the families it can register", async () => {
    const { FONT_FAMILIES } = await load();
    expect(FONT_FAMILIES.map((f) => f.value)).toEqual(["Inter", "Noto Serif"]);
  });

  it("ships all four faces for each family in FONT_SOURCES", async () => {
    const { FONT_SOURCES } = await import("./fontSources");
    expect(Object.keys(FONT_SOURCES)).toEqual(["Inter", "Noto Serif"]);
    for (const faces of Object.values(FONT_SOURCES)) {
      expect(Object.keys(faces)).toEqual(["regular", "italic", "bold", "boldItalic"]);
      for (const url of Object.values(faces)) expect(url).toBeTruthy();
    }
  });
});
