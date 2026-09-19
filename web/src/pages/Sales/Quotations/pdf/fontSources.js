// The eight font files as URLs. `?url` makes Vite hand back the asset's URL
// instead of trying to inline ~3 MB of TTF into the bundle; the PDF engine then
// fetches a face only when a quotation actually uses it.
//
// Kept apart from fonts.js so that file stays importable from plain Node (the
// live pass renders PDFs from a script, where `?url` means nothing).
import interRegular from "../../../../assets/fonts/Inter-Regular.ttf?url";
import interItalic from "../../../../assets/fonts/Inter-Italic.ttf?url";
import interBold from "../../../../assets/fonts/Inter-Bold.ttf?url";
import interBoldItalic from "../../../../assets/fonts/Inter-BoldItalic.ttf?url";
import serifRegular from "../../../../assets/fonts/NotoSerif-Regular.ttf?url";
import serifItalic from "../../../../assets/fonts/NotoSerif-Italic.ttf?url";
import serifBold from "../../../../assets/fonts/NotoSerif-Bold.ttf?url";
import serifBoldItalic from "../../../../assets/fonts/NotoSerif-BoldItalic.ttf?url";

export const FONT_SOURCES = {
  Inter: { regular: interRegular, italic: interItalic, bold: interBold, boldItalic: interBoldItalic },
  "Noto Serif": { regular: serifRegular, italic: serifItalic, bold: serifBold, boldItalic: serifBoldItalic },
};
