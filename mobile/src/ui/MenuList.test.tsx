import { StyleSheet } from "react-native";
import { fireEvent, screen } from "@testing-library/react-native";
import { Bell, UserRound } from "lucide-react-native";

import { colors } from "../theme";
import { renderWithProviders } from "../test/renderWithProviders";
import MenuList from "./MenuList";

// A finger landing and staying down (as screenParts.test), so the pressed style can be read.
const holdTouch = () => {
  const touch = { pageX: 0, pageY: 0, locationX: 0, locationY: 0, timestamp: 0 };
  return { persist: () => {}, currentTarget: { measure: () => {} }, nativeEvent: { ...touch, touches: [touch], changedTouches: [touch] } };
};

const rows = (onInbox = jest.fn(), onProfile = jest.fn()) => [
  { key: "inbox", icon: Bell, tint: "primary" as const, label: "Inbox", detail: "3 unread", onPress: onInbox },
  { key: "me", icon: UserRound, tint: "primary" as const, label: "Profile", detail: "Your account", onPress: onProfile },
];

it("draws each row's label and detail; a tap runs that row only", async () => {
  const onInbox = jest.fn();
  const onProfile = jest.fn();
  await renderWithProviders(<MenuList rows={rows(onInbox, onProfile)} />);
  expect(screen.getByText("3 unread")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Profile"));
  expect(onProfile).toHaveBeenCalledTimes(1);
  expect(onInbox).not.toHaveBeenCalled();
});

it("rows are divided, the last is not; a held row fills solid, never fades", async () => {
  await renderWithProviders(<MenuList rows={rows()} />);
  const [first, last] = screen.getAllByRole("button");
  expect(StyleSheet.flatten(first!.props.style).borderBottomWidth).toBeGreaterThan(0);
  expect(StyleSheet.flatten(last!.props.style).borderBottomWidth).toBeUndefined();
  await fireEvent(last!, "responderGrant", holdTouch());
  const held = StyleSheet.flatten(screen.getAllByRole("button")[1]!.props.style);
  expect(held.backgroundColor).toBe(colors.surfacePressed);
  expect(held.opacity).toBeUndefined();
});
