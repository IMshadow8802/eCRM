import { BackHandler, Dimensions, DeviceEventEmitter } from "react-native";
import { act, screen } from "@testing-library/react-native";

import { renderWithProviders } from "../test/renderWithProviders";
import { Sheet, SheetBackHandler } from "./Sheet";
import { Text } from "./Text";

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

// Found on the device pass (2026-11-03): gorhom only lifts a sheet by the
// keyboard's height, so a tall keyboard-aware sheet (Status with Won's
// fields) kept its Save button under the keyboard, and a tap with the
// keyboard up was spent dismissing it.
describe("a keyboard-aware sheet with the keyboard up", () => {
  type Props = { maxDynamicContentSize?: number };
  type Host = { props: Props };
  const Modal = BottomSheet.BottomSheetModal as unknown as { prototype: { render(this: Host): unknown } };
  const keyboard = (event: "keyboardDidShow" | "keyboardDidHide") =>
    act(() => {
      DeviceEventEmitter.emit(event, { endCoordinates: { screenX: 0, screenY: 500, width: 400, height: 300 } });
    });

  it("is capped to the room above the keyboard, and its body scrolls with taps kept", async () => {
    const original = Modal.prototype.render;
    let props: Props | undefined;
    jest.spyOn(Modal.prototype, "render").mockImplementation(function (this: Host) {
      props = this.props;
      return original.call(this);
    });
    await renderWithProviders(
      <Sheet keyboardAware title="Change status">
        <Text>body</Text>
      </Sheet>,
    );
    expect(props?.maxDynamicContentSize).toBeUndefined();
    expect(screen.getByTestId("sheet-scroll").props.keyboardShouldPersistTaps).toBe("handled");

    await keyboard("keyboardDidShow");
    const room = props?.maxDynamicContentSize ?? 0;
    expect(room).toBeGreaterThan(0);
    expect(room).toBeLessThanOrEqual(Dimensions.get("window").height - 300 - 26);

    await keyboard("keyboardDidHide");
    expect(props?.maxDynamicContentSize).toBeUndefined();
    jest.restoreAllMocks();
  });

  it("a sheet without inputs keeps its plain body", async () => {
    await renderWithProviders(
      <Sheet title="Pick">
        <Text>body</Text>
      </Sheet>,
    );
    expect(screen.queryByTestId("sheet-scroll")).toBeNull();
  });
});
