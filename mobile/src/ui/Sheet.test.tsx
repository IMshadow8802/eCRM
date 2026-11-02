import { BackHandler } from "react-native";

import { renderWithProviders } from "../test/renderWithProviders";
import { SheetBackHandler } from "./Sheet";

// Found on the emulator (Task 30): Android Back with a sheet open popped the
// whole screen (lead detail -> list) instead of closing the sheet.
/** Presses Android Back the way BackHandler does: newest listener first, until one handles it. */
// The real (mocked) module object — an `import * as` namespace is a copy, and a
// spy on it never reaches the component.
const BottomSheet: typeof import("@gorhom/bottom-sheet") = jest.requireMock("@gorhom/bottom-sheet");

const backButton = () => {
  const add = jest.spyOn(BackHandler, "addEventListener");
  return () =>
    add.mock.calls
      .filter(([event]) => event === "hardwareBackPress")
      .map(([, handler]) => handler)
      .reverse()
      // RN types the handler with an event arg it never passes.
      .some((handler) => (handler as () => boolean | null | undefined)() === true);
};

it("Back closes the open sheet and stops there", async () => {
  const dismiss = jest.fn(() => true);
  jest.spyOn(BottomSheet, "useBottomSheetModal").mockReturnValue({ dismiss, dismissAll: jest.fn() });
  const pressBack = backButton();
  await renderWithProviders(<SheetBackHandler />);
  expect(pressBack()).toBe(true);
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it("with no sheet open, Back falls through to navigation", async () => {
  jest.spyOn(BottomSheet, "useBottomSheetModal").mockReturnValue({ dismiss: () => false, dismissAll: jest.fn() });
  const pressBack = backButton();
  await renderWithProviders(<SheetBackHandler />);
  expect(pressBack()).toBe(false);
});
