// SearchField, InfoNote, Footnote, PageDots, ProgressBar, Checkbox, Card tones.
import { Text as RNText } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Info, Lock } from "lucide-react-native";

import { badgeTones, colors } from "../theme";
import { Card } from "./Card";
import { Checkbox } from "./Checkbox";
import { Footnote, InfoNote, PageDots } from "./Notes";
import { ProgressBar } from "./ProgressBar";
import { SearchField } from "./SearchField";

import { flat } from "../test/style";

describe("SearchField (E .srch)", () => {
  it("types in place; a clear button appears with text and empties it", async () => {
    const onChangeText = jest.fn();
    const view = await render(<SearchField testID="s" placeholder="Search number, customer, mobile" value="" onChangeText={onChangeText} />);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    await fireEvent.changeText(screen.getByTestId("s"), "AC");
    expect(onChangeText).toHaveBeenCalledWith("AC");
    await view.rerender(<SearchField testID="s" placeholder="Search" value="AC" onChangeText={onChangeText} />);
    await fireEvent.press(screen.getByRole("button", { name: "Clear search" }));
    expect(onChangeText).toHaveBeenLastCalledWith("");
    expect(flat(screen.getByTestId("s").parent!)).toMatchObject({ height: 40, borderRadius: 20, backgroundColor: colors.bandField, paddingHorizontal: 14 });
    expect(screen.getByTestId("s").props.placeholderTextColor).toBe(colors.onBandMuted);
  });

  it("with onPress it is a button that opens search, at a fixed width", async () => {
    const onPress = jest.fn();
    await render(<SearchField placeholder="Search complaints, leads, tasks" width={340} onPress={onPress} />);
    const field = screen.getByLabelText("Search complaints, leads, tasks");
    expect(flat(field).width).toBe(340);
    await fireEvent.press(field);
    expect(onPress).toHaveBeenCalled();
  });
});

describe("small parts (E §3.20)", () => {
  it("InfoNote is a primary-soft card in the inbox ink; Footnote is muted small text", async () => {
    await render(<><InfoNote icon={Info}>Swipe left</InfoNote><Footnote icon={Lock}>Private</Footnote></>);
    expect(flat(screen.getByText("Swipe left").parent!)).toMatchObject({ backgroundColor: colors.primarySoft, borderRadius: 16 });
    expect(flat(screen.getByText("Swipe left")).color).toBe(badgeTones.indigo.ink);
    expect(flat(screen.getByText("Private"))).toMatchObject({ color: colors.textMuted, fontSize: 12 });
  });

  it("PageDots: one 18 × 6 primary pill, the rest 6 dots", async () => {
    await render(<PageDots count={4} index={1} />);
    expect(screen.getAllByTestId("page-dot")).toHaveLength(3);
    expect(flat(screen.getByTestId("page-dot-active"))).toMatchObject({ width: 18, height: 6, backgroundColor: colors.primary });
    expect(flat(screen.getAllByTestId("page-dot")[0]!)).toMatchObject({ width: 6, backgroundColor: colors.iconFaint });
    expect(screen.getByLabelText("Page 2 of 4")).toBeOnTheScreen();
  });

  it.each([
    [0.6, "md", 60, 6], [2, "lg", 100, 8], [-1, "md", 0, 6], [Number.NaN, "md", 0, 6],
  ] as const)("ProgressBar %f (%s) → %i%%", async (value, size, pct, h) => {
    await render(<ProgressBar value={value} size={size} width={40} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.props.accessibilityValue.now).toBe(pct);
    expect(flat(bar)).toMatchObject({ height: h, width: 40, backgroundColor: colors.track });
  });

  it("ProgressBar without a width stretches", async () => {
    await render(<ProgressBar value={0.5} />);
    expect(flat(screen.getByRole("progressbar")).alignSelf).toBe("stretch");
  });

  it("Checkbox: 22, radius 7; done is solid green; a tap toggles", async () => {
    const onPress = jest.fn();
    const view = await render(<Checkbox checked={false} onPress={onPress} accessibilityLabel="Call back" />);
    const box = () => flat(screen.getByRole("checkbox").children[0] as never);
    expect(box()).toMatchObject({ width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: colors.borderStrong });
    await fireEvent.press(screen.getByRole("checkbox", { name: "Call back" }));
    expect(onPress).toHaveBeenCalled();
    await view.rerender(<Checkbox checked onPress={onPress} />);
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(box().backgroundColor).toBe(colors.success);
  });

  it("a read-only checkbox is not a control", async () => {
    await render(<Checkbox checked />);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it.each([
    ["muted", colors.surfaceMuted], ["followUp", colors.followUpTint], ["danger", colors.dangerCardTint], ["brandSoft", colors.primarySoft],
  ] as const)("Card tone %s fills without a shadow", async (tone, fill) => {
    await render(<Card tone={tone}><RNText>Body</RNText></Card>);
    const style = flat(screen.getByText("Body").parent!);
    expect(style).toMatchObject({ backgroundColor: fill, borderRadius: 16 });
    expect(style.boxShadow).toBeUndefined();
  });
});
