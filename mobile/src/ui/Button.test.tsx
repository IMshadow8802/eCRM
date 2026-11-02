import { StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Plus } from "lucide-react-native";

import { colors } from "../theme";
import { Button, type ButtonVariant } from "./Button";

it("a press runs the action", async () => {
  const onPress = jest.fn();
  await render(<Button title="Save" icon={Plus} size="sm" onPress={onPress} />);
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

it("disabled blocks the press and is announced", async () => {
  const onPress = jest.fn();
  await render(<Button title="Save" disabled onPress={onPress} />);
  const button = screen.getByRole("button");
  expect(button).toBeDisabled();
  await fireEvent.press(button);
  expect(onPress).not.toHaveBeenCalled();
});

it("loading blocks the press, hides the label and reads as busy", async () => {
  const onPress = jest.fn();
  await render(<Button title="Save" variant="secondary" loading onPress={onPress} />);
  const button = screen.getByRole("button");
  expect(button).toBeBusy();
  expect(screen.queryByText("Save")).toBeNull();
  await fireEvent.press(button);
  expect(onPress).not.toHaveBeenCalled();
});

// §9.3: a disabled control is a solid muted fill, never faded with opacity.
it.each<[ButtonVariant, string]>([
  ["primary", colors.primaryDim],
  ["danger", colors.dangerDim],
  ["ghost", colors.disabledBg],
  ["onBrand", colors.disabledBg],
])("disabled %s is a solid fill, not an opacity", async (variant, fill) => {
  await render(<Button title="Go" variant={variant} fullWidth disabled />);
  const style = StyleSheet.flatten(screen.getByRole("button").props.style);
  expect(style.backgroundColor).toBe(fill);
  expect(style.opacity).toBeUndefined();
});
