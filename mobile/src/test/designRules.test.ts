// Design rules eslint cannot see (CLAUDE.md §9.3–9.5): solid colours only,
// lucide only, no emoji in UI, no colour literal outside the theme. Scans every
// source file under src/ except tests, this harness and src/theme/ (the one
// place colours are defined — including the scrim's single allowed rgba).
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const SRC = join(__dirname, "..");

const RULES: { name: string; re: RegExp }[] = [
  { name: "rgba() — translucent colour", re: /rgba\s*\(/ },
  // `opacity:` as a style key. shadowOpacity is a shadow, not a fill: the
  // capital O and the letters before it keep it out of this match.
  { name: "opacity style — dims by translucency", re: /(^|[^\w])opacity\s*:/ },
  { name: "emoji — use a lucide icon", re: /\p{Extended_Pictographic}/u },
  {
    name: "icon import other than lucide-react-native",
    re: /from\s+["'](?!lucide-react-native["'])[^"']*(icon|symbol)[^"']*["']/i,
  },
  { name: "hex colour literal — read a token", re: /["'`]#[0-9a-fA-F]{3,8}\b/ },
];

/** Comments may talk about a rule; only code can break one. */
const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

function violations(code: string): string[] {
  const clean = stripComments(code);
  return RULES.filter((r) => r.re.test(clean)).map((r) => r.name);
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "theme" || name === "test" ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

it("every source file under src/ follows the design rules", () => {
  const found = sources(SRC).flatMap((file) =>
    violations(readFileSync(file, "utf8")).map((rule) => `${relative(SRC, file)}: ${rule}`),
  );
  expect(found).toEqual([]);
});

// Each rule must actually bite, or the scan above proves nothing.
it.each([
  ["rgba", `const s = { backgroundColor: "rgba(0,0,0,0.5)" };`],
  ["opacity", `const s = StyleSheet.create({ dim: { opacity: 0.5 } });`],
  ["emoji in JSX", `const G = () => <Text>Hi 👋</Text>;`],
  ["vector-icons", `import { Ionicons } from "@expo/vector-icons";`],
  ["expo-symbols", `import { SymbolView } from "expo-symbols";`],
  ["hex", `const c = "#3F4FAF";`],
])("catches a planted %s", (_, code) => {
  expect(violations(code)).toHaveLength(1);
});

it("lets the allowed forms through", () => {
  expect(
    violations(
      [
        `import { Hand } from "lucide-react-native";`,
        `const s = { ...shadows.md, shadowOpacity: 0.05 };`,
        `// a comment may say rgba( or opacity: or #FFF or 👋`,
        `/* block: "#123456" */`,
        `const url = "https://example.com/a#b";`,
      ].join("\n"),
    ),
  ).toEqual([]);
});
