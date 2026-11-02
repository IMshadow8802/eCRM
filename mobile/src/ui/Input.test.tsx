import { StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Search } from "lucide-react-native";

import { colors } from "../theme";
import { Input } from "./Input";

it("types through, shows label, required mark and error over the hint", async () => {
  const onChangeText = jest.fn();
  await render(
    <Input label="Name" required error="Name is required" hint="As on the ID" placeholder="Full name" leftIcon={Search} onChangeText={onChangeText} />,
  );
  expect(screen.getByText(" *")).toBeOnTheScreen();
  expect(screen.getByText("Name is required")).toBeOnTheScreen();
  expect(screen.queryByText("As on the ID")).toBeNull();
  await fireEvent.changeText(screen.getByPlaceholderText("Full name"), "Asha");
  expect(onChangeText).toHaveBeenCalledWith("Asha");
});

it("shows the hint when there is no error", async () => {
  await render(<Input label="Email" tone="onBrand" hint="We never share it" />);
  expect(screen.getByText("We never share it")).toBeOnTheScreen();
});

it("password is hidden until the eye is tapped, and hidden again on a second tap", async () => {
  await render(<Input placeholder="Password" password />);
  const field = screen.getByPlaceholderText("Password");
  expect(field.props.secureTextEntry).toBe(true);
  await fireEvent.press(screen.getByLabelText("Show password"));
  expect(screen.getByPlaceholderText("Password").props.secureTextEntry).toBe(false);
  await fireEvent.press(screen.getByLabelText("Hide password"));
  expect(screen.getByPlaceholderText("Password").props.secureTextEntry).toBe(true);
});

const borderOf = (placeholder: string) =>
  StyleSheet.flatten(screen.getByPlaceholderText(placeholder).parent!.props.style).borderColor;

it("focus shows the ring and blur removes it", async () => {
  await render(<Input placeholder="Note" multiline />);
  await fireEvent(screen.getByPlaceholderText("Note"), "focus");
  expect(borderOf("Note")).toBe(colors.primary);
  await fireEvent(screen.getByPlaceholderText("Note"), "blur");
  expect(borderOf("Note")).toBe(colors.borderStrong);
});

// Regression: `{...rest}` was spread after the wrappers, so a caller's own
// onFocus/onBlur replaced them and the focus ring never appeared.
it("a caller's onFocus/onBlur run AND the focus ring still shows", async () => {
  const onFocus = jest.fn();
  const onBlur = jest.fn();
  await render(<Input placeholder="Search" onFocus={onFocus} onBlur={onBlur} />);
  await fireEvent(screen.getByPlaceholderText("Search"), "focus");
  expect(onFocus).toHaveBeenCalledTimes(1);
  expect(borderOf("Search")).toBe(colors.primary);
  await fireEvent(screen.getByPlaceholderText("Search"), "blur");
  expect(onBlur).toHaveBeenCalledTimes(1);
  expect(borderOf("Search")).toBe(colors.borderStrong);
});

it("a bare field has no border of its own", async () => {
  await render(<Input placeholder="Reply" bare />);
  const style = StyleSheet.flatten(screen.getByPlaceholderText("Reply").parent!.props.style);
  expect(style.borderWidth).toBe(0);
});

it("a read-only field cannot be edited", async () => {
  await render(<Input placeholder="Code" editable={false} />);
  expect(screen.getByPlaceholderText("Code")).not.toBeEnabled();
});
