import { DeviceEventEmitter, ScrollView, View } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { Input } from "./Input";
import { KeyboardScrollView } from "./KeyboardScrollView";

// Android brings only the caret's line into view; these pin that the whole
// field (box + help) is scrolled above the keyboard instead.
const keyboard = (event: "keyboardDidShow" | "keyboardDidHide") =>
  act(() => {
    DeviceEventEmitter.emit(event, { endCoordinates: { screenX: 0, screenY: 500, width: 400, height: 300 } });
  });

/** The focused field sits at `y` (content coordinates) and is `h` tall. */
const fieldAt = (y: number, h: number) =>
  jest.spyOn(View.prototype as unknown as { measureLayout: (...a: unknown[]) => void }, "measureLayout")
    .mockImplementation((_rel: unknown, onSuccess: unknown) => (onSuccess as (x: number, y: number, w: number, h: number) => void)(0, y, 400, h));

let scrollTo: jest.SpyInstance;
beforeEach(() => {
  scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation(() => {});
  jest.spyOn(ScrollView.prototype as unknown as { getInnerViewRef: () => unknown }, "getInnerViewRef").mockReturnValue({});
});
afterEach(async () => {
  await keyboard("keyboardDidHide");
  jest.restoreAllMocks();
});

const mount = async () => {
  await render(
    <KeyboardScrollView testID="scroll">
      <Input placeholder="Pincode" />
    </KeyboardScrollView>,
  );
  // Resting viewport 800; the keyboard (via the app's avoider) shrinks it to 400.
  await fireEvent(screen.getByTestId("scroll"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } } });
};

it("scrolls the whole field and 16 below it above the keyboard once the view shrinks", async () => {
  fieldAt(600, 70);
  await mount();
  await fireEvent(screen.getByPlaceholderText("Pincode"), "focus");
  expect(scrollTo).not.toHaveBeenCalled(); // no keyboard yet
  await keyboard("keyboardDidShow");
  await fireEvent(screen.getByTestId("scroll"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 400 } } });
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 600 + 70 + 16 - 400, animated: true });
});

it("leaves a field that is already in view alone", async () => {
  fieldAt(100, 70);
  await mount();
  await keyboard("keyboardDidShow");
  await fireEvent(screen.getByTestId("scroll"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 400 } } });
  await fireEvent(screen.getByPlaceholderText("Pincode"), "focus");
  expect(scrollTo).not.toHaveBeenCalled();
});

it("brings a field scrolled above the top back down, and a tall one shows its top", async () => {
  fieldAt(50, 70);
  await mount();
  await keyboard("keyboardDidShow");
  await fireEvent(screen.getByTestId("scroll"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 400 } } });
  await fireEvent.scroll(screen.getByTestId("scroll"), { nativeEvent: { contentOffset: { x: 0, y: 200 } } });
  await fireEvent(screen.getByPlaceholderText("Pincode"), "focus");
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 34, animated: true });

  fieldAt(1000, 600);
  await fireEvent(screen.getByPlaceholderText("Pincode"), "focus");
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 1000 - 16, animated: true });
});

it("forgets the field on blur", async () => {
  fieldAt(600, 70);
  await mount();
  await fireEvent(screen.getByPlaceholderText("Pincode"), "focus");
  await fireEvent(screen.getByPlaceholderText("Pincode"), "blur");
  await keyboard("keyboardDidShow");
  expect(scrollTo).not.toHaveBeenCalled();
});

it("an Input outside one does nothing extra", async () => {
  await render(<Input placeholder="Alone" />);
  await fireEvent(screen.getByPlaceholderText("Alone"), "focus");
  expect(scrollTo).not.toHaveBeenCalled();
});
