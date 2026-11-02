import { fireEvent, render, screen } from "@testing-library/react-native";

import { MobileInput } from "./MobileInput";

const typed = async (text: string) => {
  const onChangeText = jest.fn();
  await render(<MobileInput label="Mobile" onChangeText={onChangeText} />);
  await fireEvent.changeText(screen.getByPlaceholderText("10-digit number"), text);
  return onChangeText.mock.calls.at(-1)?.[0];
};

it("a pasted +91 number keeps its tail, not its country code", async () => {
  expect(await typed("+91 98250 12345")).toBe("9825012345");
});

it("drops a leading 0 and the separators people type", async () => {
  expect(await typed("098250-12345")).toBe("9825012345");
});

it("never truncates — a wrong length goes to the server to refuse", async () => {
  expect(await typed("98250123456789")).toBe("98250123456789");
});

it("a partly typed number is handed back as its digits", async () => {
  expect(await typed("98250 1")).toBe("982501");
});

it("carries no maxLength, so the OS cannot cut a paste short", async () => {
  await render(<MobileInput value="" />);
  const field = screen.getByPlaceholderText("10-digit number");
  expect(field.props.maxLength).toBeUndefined();
  expect(field.props.keyboardType).toBe("phone-pad");
  // No handler is fine too.
  await fireEvent.changeText(field, "1");
});

it("passes label and error through like any Input", async () => {
  await render(<MobileInput label="Mobile" error="Mobile number must be 10 digits" />);
  expect(screen.getByText("Mobile")).toBeOnTheScreen();
  expect(screen.getByText("Mobile number must be 10 digits")).toBeOnTheScreen();
});
