import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { Headset } from "lucide-react-native";

import { badgeTones, colors } from "../theme";
import { CountBadge, CountPill, capCount } from "./CountBadge";
import { StatusBadge, type StatusBadgeSize } from "./StatusBadge";

const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);

describe("StatusBadge (E §3.6)", () => {
  it.each<[StatusBadgeSize, number, number]>([
    [28, 9, 14], [32, 10, 16], [36, 12, 18], [40, 12, 20], [48, 14, 22], [52, 16, 22], [72, 22, 32],
  ])("size %i: radius %i, icon %i", async (size, r, icon) => {
    await render(<StatusBadge testID="b" tone="peach" icon={Headset} size={size} />);
    expect(flat("b")).toMatchObject({ width: size, height: size, borderRadius: r, backgroundColor: badgeTones.peach.fill });
    const glyph = screen.getByTestId("b").props.children[0];
    expect(glyph.props).toMatchObject({ size: icon, color: badgeTones.peach.ink });
  });

  it("defaults to 40 and no escalated dot", async () => {
    await render(<StatusBadge testID="b" tone="sky" icon={Headset} />);
    expect(flat("b").width).toBe(40);
    expect(screen.queryByTestId("escalated-dot")).toBeNull();
  });

  it("escalated adds the violet 20 dot, ringed in what it sits on", async () => {
    await render(<StatusBadge tone="sky" icon={Headset} escalated ringColor="primarySoft" />);
    expect(flat("escalated-dot")).toMatchObject({
      width: 20, height: 20, right: -5, bottom: -5, borderWidth: 2, backgroundColor: colors.escalate, borderColor: colors.primarySoft,
    });
  });

  it("ring draws a 4 px background border; iconSize overrides the glyph", async () => {
    await render(<StatusBadge testID="b" tone="green" icon={Headset} size={52} ring iconSize={30} />);
    expect(flat("b")).toMatchObject({ borderWidth: 4, borderColor: colors.background });
    expect(screen.getByTestId("b").props.children[0].props.size).toBe(30);
  });
});

describe("CountBadge / CountPill", () => {
  it("caps at 99+", () => {
    expect(capCount(5)).toBe("5");
    expect(capCount(99)).toBe("99");
    expect(capCount(100)).toBe("99+");
  });

  it("is a coral 20 × 18 badge with a 2 px ring, hidden at zero", async () => {
    const view = await render(<CountBadge count={140} />);
    const box = StyleSheet.flatten(screen.getByLabelText("140 new").props.style);
    expect(box).toMatchObject({ minWidth: 20, height: 18, borderRadius: 9, borderWidth: 2, backgroundColor: colors.coral, borderColor: colors.band });
    expect(screen.getByText("99+")).toBeOnTheScreen();
    await view.rerender(<CountBadge count={0} />);
    expect(screen.queryByText("0")).toBeNull();
  });

  it.each([
    ["default", colors.bandField, colors.onBandSoft],
    ["active", colors.primary, colors.textOnBrand],
    ["danger", colors.coral, colors.textOnBrand],
  ] as const)("count pill %s", async (tone, fill, ink) => {
    await render(<CountPill count={7} tone={tone} />);
    const text = screen.getByText("7");
    expect(StyleSheet.flatten(text.props.style).color).toBe(ink);
    expect(StyleSheet.flatten(text.parent!.props.style)).toMatchObject({ backgroundColor: fill, height: 18, minWidth: 20, borderRadius: 9 });
  });
});
