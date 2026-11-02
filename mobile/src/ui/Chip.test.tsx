import { StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Flag } from "lucide-react-native";

import { chipTones } from "../theme";
import { Chip, type ChipSize } from "./Chip";

const shell = (text: string) => StyleSheet.flatten(screen.getByText(text).parent!.props.style);

it("a tone picks the sorbet pair; the default is slate", async () => {
  await render(<><Chip label="Overdue" tone="red" /><Chip label="Low" /></>);
  expect(shell("Overdue").backgroundColor).toBe(chipTones.red.fill);
  expect(StyleSheet.flatten(screen.getByText("Overdue").props.style).color).toBe(chipTones.red.text);
  expect(shell("Low").backgroundColor).toBe(chipTones.slate.fill);
});

it.each<[ChipSize, number, number]>([["xs", 18, 9], ["sm", 22, 9], ["md", 28, 12], ["lg", 32, 12]])(
  "%s is %i tall with %i padding, fully round", async (size, height, pad) => {
    await render(<Chip label="x" size={size} />);
    expect(shell("x")).toMatchObject({ height, borderRadius: height / 2, paddingHorizontal: pad });
  });

it("iconOnly is a 22 square flag, labelled for screen readers", async () => {
  await render(<Chip iconOnly icon={Flag} tone="red" accessibilityLabel="High priority" />);
  const chip = screen.getByLabelText("High priority");
  expect(StyleSheet.flatten(chip.props.style)).toMatchObject({ width: 22, height: 22 });
  expect(screen.queryByText(/./)).toBeNull();
});

it("caps its width when asked", async () => {
  await render(<Chip label="A long company label" maxWidth={80} />);
  expect(shell("A long company label").maxWidth).toBe(80);
});

it("a pressable chip presses and reaches 44 through hitSlop", async () => {
  const onPress = jest.fn();
  await render(<Chip label="Done" size="lg" tone="green" onPress={onPress} />);
  const button = screen.getByRole("button", { name: "Done" });
  expect(button.props.hitSlop).toBe(6);
  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
});
