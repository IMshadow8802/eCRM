// Design rules eslint cannot see (CLAUDE.md §9.3–9.5): solid colours only,
// lucide only, no emoji in UI, no colour literal outside the theme. Scans every
// source file under src/ except tests, this harness and src/theme/ (the one
// place colours are defined — including the scrim's single allowed rgba).
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";

const SRC = join(__dirname, "..");

/**
 * Drops // and block comments but leaves string and template contents alone,
 * so "https://x" or "a // b" in a string is still scanned. A comment may talk
 * about a rule; only code can break one.
 */
function stripComments(code: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]!;
    if (quote) {
      out += ch;
      if (ch === "\\") out += code[++i] ?? "";
      else if (ch === quote || (ch === "\n" && quote !== "`")) quote = null;
    } else if (ch === "/" && code[i + 1] === "/") {
      while (i < code.length && code[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end < 0 ? code.length : end + 1;
    } else {
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      out += ch;
    }
  }
  return out;
}

/** Every module specifier: import … from, bare import, export … from, require(). */
const SPECIFIER =
  /\bimport\s+(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']|\bexport\s+[^"'`;]*?\s+from\s+["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
const ICONISH = /icon|symbol|svg|fontawesome|phosphor/i;

const specifiers = (code: string) => [...code.matchAll(SPECIFIER)].map((m) => m[1] ?? m[2] ?? m[3]!);

function badIconImport(code: string, file: string): boolean {
  const inUi = file.startsWith("ui/");
  return specifiers(code)
    .some(
      (spec) =>
        ICONISH.test(spec) &&
        // Our own modules ("./IconButton") are not icon libraries.
        !spec.startsWith(".") &&
        !spec.startsWith("lucide-react-native") &&
        // Drawing primitives belong to the design system, never to a screen.
        !(inUi && spec === "react-native-svg"),
    );
}

/** Each rule sees the comment-free code and the file's path under src/ ("ui/Chip.tsx"). */
const RULES: { name: string; test: (code: string, file: string) => boolean }[] = [
  { name: "rgba() — translucent colour", test: (c) => /rgba\s*\(/.test(c) },
  {
    // `opacity: x`, `"opacity": x` and the `{ opacity }` shorthand. shadowOpacity
    // is a shadow, not a fill: the letters before it keep it out.
    name: "opacity style — dims by translucency",
    test: (c) => /(^|[^\w"'])opacity\s*:|["']opacity["']\s*:|[{,]\s*opacity\s*[,}]/.test(c),
  },
  {
    name: "emoji — use a lucide icon",
    test: (c) => /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(c),
  },
  { name: "icon import other than lucide-react-native", test: badIconImport },
  { name: "hex colour literal — read a token", test: (c) => /["'`]#[0-9a-fA-F]{3,8}\b/.test(c) },
  // E §5.3 (Task 33). A coloured edge rail was the old card accent; E carries
  // status in a badge and a pill. (theme/ is not scanned at all.)
  { name: "edge rail — use a badge", test: (c) => /border(Left|Right|Start|End)(Width|Color)\s*:/.test(c) },
  // The weight is the Inter family; fontWeight renders regular on Android.
  { name: "fontWeight — pick a variant", test: (c) => /fontWeight\s*:/.test(c) },
  {
    name: "gradient outside auth",
    test: (c, file) => !file.startsWith("features/auth/") && specifiers(c).includes("expo-linear-gradient"),
  },
];

function violations(code: string, file = "features/x.tsx"): string[] {
  const clean = stripComments(code);
  return RULES.filter((r) => r.test(clean, file)).map((r) => r.name);
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "theme" || name === "test" ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

it("every source file under src/ follows the design rules", () => {
  const files = sources(SRC).map((file) => relative(SRC, file).split(sep).join("/"));
  // A scan that found nothing proves nothing.
  expect(files.length).toBeGreaterThan(50);
  expect(files).toContain("ui/Chip.tsx");

  const found = files.flatMap((file) =>
    violations(readFileSync(join(SRC, file), "utf8"), file).map((rule) => `${file}: ${rule}`),
  );
  expect(found).toEqual([]);
});

// Each rule must actually bite, or the scan above proves nothing.
it.each([
  ["rgba", `const s = { backgroundColor: "rgba(0,0,0,0.5)" };`],
  ["opacity key", `const s = StyleSheet.create({ dim: { opacity: 0.5 } });`],
  ["quoted opacity key", `const s = { "opacity": 0.5 };`],
  ["opacity shorthand", `const opacity = 0.5; const s = { opacity };`],
  ["emoji in JSX", `const G = () => <Text>Hi 👋</Text>;`],
  ["flag", `const f = "🇮🇳";`],
  ["keycap", `const k = "1⃣";`],
  ["vector-icons", `import { Ionicons } from "@expo/vector-icons";`],
  ["required vector-icons", `const I = require("@expo/vector-icons");`],
  ["re-exported icons", `export { Ionicons } from "@expo/vector-icons";`],
  ["expo-symbols", `import { SymbolView } from "expo-symbols";`],
  ["phosphor", `import { House } from "phosphor-react-native";`],
  ["fontawesome", `import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";`],
  ["hand-drawn svg in a screen", `import Svg, { Path } from "react-native-svg";`],
  ["hex", `const c = "#3F4FAF";`],
  ["hex after a // inside a string", `const u = "a // b"; const c = "#3F4FAF";`],
  ["left edge rail", `const s = { borderLeftWidth: 3 };`],
  ["end edge colour", `const s = { borderEndColor: colors.primary };`],
  ["fontWeight", `const s = { fontWeight: "600" };`],
  ["gradient in a screen", `import { LinearGradient } from "expo-linear-gradient";`],
])("catches a planted %s", (_, code) => {
  expect(violations(code)).toHaveLength(1);
});

it("lets the allowed forms through", () => {
  expect(
    violations(
      [
        `import { Hand } from "lucide-react-native";`,
        `import Hand from "lucide-react-native/dist/esm/icons/hand";`,
        `const s = { ...shadows.md, shadowOpacity: 0.05 };`,
        `// a comment may say rgba( or opacity: or #FFF or 👋`,
        `/* block: "#123456" */`,
        `const url = "https://example.com/a#b";`,
      ].join("\n"),
    ),
  ).toEqual([]);
  // The design system itself may draw with react-native-svg.
  expect(violations(`import Svg from "react-native-svg";`, "ui/Svg.tsx")).toEqual([]);
  // Our own modules may have "icon" in the name.
  expect(violations(`import { IconButton } from "./IconButton";`, "ui/Band.tsx")).toEqual([]);
  // The auth backdrop is the one gradient.
  expect(violations(`import { LinearGradient } from "expo-linear-gradient";`, "features/auth/Login.tsx")).toEqual([]);
  // A full border is not an edge rail.
  expect(violations(`const s = { borderWidth: 1, borderColor: colors.border, borderTopLeftRadius: 4 };`)).toEqual([]);
});
