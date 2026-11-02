import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { Text } from "../ui/Text";
import { fontFamily, typography, type TypographyVariant } from "./typography";

const LOADED = new Set<string>(Object.values(fontFamily));

describe("E §1.7 type ramp", () => {
  it.each(Object.entries(typography))("%s names a loaded Inter family", (_, style) =>
    expect(LOADED.has(style.fontFamily)).toBe(true));

  it.each([
    ["display", 28, 34, "Inter_700Bold"], ["statLg", 40, 46, "Inter_700Bold"], ["stat", 32, 38, "Inter_700Bold"],
    ["tileValue", 28, 32, "Inter_700Bold"], ["statValue", 28, 34, "Inter_700Bold"], ["titleXl", 26, 32, "Inter_700Bold"],
    ["figure", 24, 30, "Inter_700Bold"], ["titleLg", 24, 30, "Inter_700Bold"], ["h1", 22, 28, "Inter_700Bold"],
    ["recordTitle", 20, 26, "Inter_700Bold"], ["sheetTitle", 18, 24, "Inter_700Bold"], ["h2", 17, 22, "Inter_600SemiBold"],
    ["cardTitle", 16, 22, "Inter_600SemiBold"], ["groupTitle", 16, 22, "Inter_700Bold"], ["bodyLg", 15, 22, "Inter_400Regular"],
    ["body", 15, 20, "Inter_400Regular"], ["bodyStrong", 15, 20, "Inter_600SemiBold"], ["rowTitle", 14, 20, "Inter_600SemiBold"],
    ["text", 14, 20, "Inter_400Regular"], ["amount", 14, 20, "Inter_700Bold"], ["meta", 13, 18, "Inter_400Regular"],
    ["metaStrong", 13, 18, "Inter_600SemiBold"], ["tab", 14, 20, "Inter_600SemiBold"], ["label", 12, 16, "Inter_600SemiBold"],
    ["small", 12, 16, "Inter_400Regular"], ["smallMedium", 12, 16, "Inter_500Medium"], ["overline", 12, 16, "Inter_600SemiBold"],
    ["navLabel", 11, 14, "Inter_500Medium"], ["navLabelActive", 11, 14, "Inter_600SemiBold"], ["count", 11, 18, "Inter_700Bold"],
    ["badge", 10, 14, "Inter_700Bold"],
  ] as const)("%s is %i/%i in %s", (name, size, line, family) =>
    expect(typography[name]).toMatchObject({ fontSize: size, lineHeight: line, fontFamily: family }));

  it("tracking and case", () => {
    expect(typography.display.letterSpacing).toBe(-0.3);
    expect(typography.stat.letterSpacing).toBe(-0.5);
    expect(typography.h1.letterSpacing).toBe(-0.2);
    expect(typography.overline).toMatchObject({ letterSpacing: 0.6, textTransform: "uppercase" });
  });

  it.each(["statLg", "stat", "tileValue", "statValue", "figure", "amount", "count", "badge"] as TypographyVariant[])(
    "%s uses tabular figures", (name) => expect(typography[name].fontVariant).toEqual(["tabular-nums"]));

  it.each([
    ["h3", "rowTitle"], ["secondary", "meta"], ["caption", "label"], ["button", "bodyStrong"],
  ] as const)("retired %s renders as %s", (old, now) => {
    const { color: _a, ...a } = typography[old];
    const { color: _b, ...b } = typography[now];
    expect(a).toEqual(b);
  });
});

describe("Text", () => {
  const style = () => StyleSheet.flatten(screen.getByText("x").props.style);

  it("defaults to the 14/20 text variant, capped at 1.3× system scaling", async () => {
    await render(<Text>x</Text>);
    expect(style()).toMatchObject({ fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" });
    expect(screen.getByText("x").props.maxFontSizeMultiplier).toBe(1.3);
    expect(style().fontVariant).toBeUndefined();
  });

  it("tabular sets tabular figures", async () => {
    await render(<Text tabular>x</Text>);
    expect(style().fontVariant).toEqual(["tabular-nums"]);
  });

  it.each([
    ["navLabel", 1.15], ["count", 1.15], ["tab", 1.15], ["stat", 1.2], ["figure", 1.2], ["rowTitle", 1.3],
  ] as const)("%s caps font scaling at %f", async (variant, cap) => {
    await render(<Text variant={variant}>x</Text>);
    expect(screen.getByText("x").props.maxFontSizeMultiplier).toBe(cap);
  });

  it("scaleCap and an explicit multiplier override the group", async () => {
    await render(<><Text variant="label" scaleCap="chrome">x</Text><Text maxFontSizeMultiplier={2}>y</Text></>);
    expect(screen.getByText("x").props.maxFontSizeMultiplier).toBe(1.15);
    expect(screen.getByText("y").props.maxFontSizeMultiplier).toBe(2);
  });

  it("colour and alignment come from tokens", async () => {
    await render(<Text color="dangerText" align="center">x</Text>);
    expect(style()).toMatchObject({ color: "#A8200F", textAlign: "center" });
  });
});
