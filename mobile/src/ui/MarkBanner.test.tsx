import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";

import { colors } from "../theme";
import { MarkBanner } from "./MarkBanner";

const bg = () => StyleSheet.flatten(screen.getByRole("alert").props.style).backgroundColor;

it("do not call: the solid danger surface, the note, who marked it and when", async () => {
  await render(<MarkBanner mark="dnc" note="Said stop calling" by="Priya Verma" at="2026-11-20T04:45:00.000Z" />);
  expect(screen.getByText("Do not call — Said stop calling · marked by Priya Verma, 20 Nov")).toBeOnTheScreen();
  expect(bg()).toBe(colors.dangerSoft);
});

it("caution: the solid warning surface and the note; no byline without one", async () => {
  await render(<MarkBanner mark="caution" note="Call after 6 pm" />);
  expect(screen.getByText("Call with caution — Call after 6 pm")).toBeOnTheScreen();
  expect(bg()).toBe(colors.warningSoft);
});

it("a byline without a date still names who marked it", async () => {
  await render(<MarkBanner mark="caution" note="x" by="Asha" />);
  expect(screen.getByText("Call with caution — x · marked by Asha")).toBeOnTheScreen();
});

it("an instant late in the UTC day is the next local (IST) day", async () => {
  await render(<MarkBanner mark="dnc" note="x" by="Asha" at="2026-11-20T20:00:00.000Z" />);
  expect(screen.getByText("Do not call — x · marked by Asha, 21 Nov")).toBeOnTheScreen();
});

it("renders nothing without a mark", async () => {
  await render(<MarkBanner mark={null} note="ignored" />);
  expect(screen.queryByRole("alert")).toBeNull();
});
