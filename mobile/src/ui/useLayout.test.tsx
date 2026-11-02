import { render, screen } from "@testing-library/react-native";
import { Text, useWindowDimensions } from "react-native";

import { layoutFor, useLayout } from "./useLayout";

describe("layoutFor (spec §2.1)", () => {
  it("390 × 844 phone: compact, bar, one pane, 2-column bento, gutter 16", () => {
    expect(layoutFor(390, 844)).toEqual({
      sizeClass: "compact", width: 390, height: 844, isLandscape: false, nav: "bar", isTwoPane: false,
      contentMaxWidth: 390, columns: 2, gutter: 16,
    });
  });

  it("700 × 1000 small tablet: medium, rail, single pane, forms 640", () => {
    expect(layoutFor(700, 1000)).toMatchObject({
      sizeClass: "medium", nav: "rail", isTwoPane: false, contentMaxWidth: 640, columns: 2, gutter: 24,
    });
  });

  it("1194 × 834 tablet (T1–T3): expanded, rail, two panes, 3 columns", () => {
    expect(layoutFor(1194, 834)).toMatchObject({
      sizeClass: "expanded", isLandscape: true, nav: "rail", isTwoPane: true, contentMaxWidth: 640, columns: 3, gutter: 32,
    });
  });

  it("834 × 1194 tablet portrait: rail, but one pane (rule 5: detail would be 322)", () => {
    expect(layoutFor(834, 1194)).toMatchObject({ sizeClass: "medium", nav: "rail", isTwoPane: false });
  });

  it("an expanded width whose detail pane would be under 480 stays single pane", () => {
    expect(layoutFor(900, 1200)).toMatchObject({ sizeClass: "expanded", isTwoPane: false, columns: 3 });
    expect(layoutFor(992, 1200)).toMatchObject({ isTwoPane: true });
  });

  it("844 × 390 landscape phone: capped at medium — rail, never two panes", () => {
    expect(layoutFor(844, 390)).toMatchObject({ sizeClass: "medium", isLandscape: true, nav: "rail", isTwoPane: false });
  });

  it("600 is the first medium width, 840 the first expanded", () => {
    expect(layoutFor(599, 900).sizeClass).toBe("compact");
    expect(layoutFor(600, 900).sizeClass).toBe("medium");
    expect(layoutFor(839, 900).sizeClass).toBe("medium");
    expect(layoutFor(840, 900).sizeClass).toBe("expanded");
  });
});

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 1194, height: 834, scale: 2, fontScale: 1 })),
}));

it("useLayout reads the live window", async () => {
  const Probe = () => {
    const l = useLayout();
    return <Text>{`${l.sizeClass} ${l.nav}`}</Text>;
  };
  await render(<Probe />);
  expect(screen.getByText("expanded rail")).toBeOnTheScreen();
  expect(useWindowDimensions).toHaveBeenCalled();
});
