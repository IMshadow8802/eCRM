import { DeviceEventEmitter, Platform, StatusBar as RNStatusBar, StyleSheet } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import App from "./App";

// The real provider renders nothing until native reports insets.
jest.mock("react-native-safe-area-context", () => jest.requireActual("react-native-safe-area-context/jest/mock").default);
jest.mock("./src/theme/fonts", () => ({ useAppFonts: () => true }));
jest.mock("./src/features/auth/useAccess", () => ({ useAccessRefresh: () => undefined }));
jest.mock("./src/features/auth/PresenceNoticeDialog", () => () => null);
jest.mock("./src/features/auth/ReauthDialog", () => () => null);
// Every screen opens on the navy band, which asks for light status-bar content.
jest.mock("./src/navigation/RootNavigator", () => {
  const { Band } = jest.requireActual("./src/ui/Band");
  return function MockNavigator() {
    const { TextInput } = jest.requireActual("react-native");
    return (
      <>
        <Band title="Today" />
        <TextInput testID="screen-field" />
      </>
    );
  };
});

// RN keeps every mounted <StatusBar> on a stack in mount order; the last push wins.
it("leaves the status bar light over the navy band (no app-level dark entry wins)", async () => {
  const push = jest.spyOn(RNStatusBar, "pushStackEntry");
  await render(<App />);
  const styles = push.mock.calls.map(([props]) => props.barStyle);
  expect(styles.length).toBeGreaterThan(0);
  expect(styles).not.toContain("dark-content");
  expect(styles[styles.length - 1]).toBe("light-content");
});

// Android edge-to-edge (forced from API 35) ignores adjustResize: without this
// every screen's lowest field and its submit bar sat under the keyboard.
it("lifts every screen above the keyboard on Android, as adjustResize used to", async () => {
  jest.replaceProperty(Platform, "OS", "android");
  await render(<App />);
  const avoider = screen.getByTestId("app-keyboard");
  await fireEvent(avoider, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } }, persist: () => {} });
  await act(() => {
    DeviceEventEmitter.emit("keyboardDidShow", { endCoordinates: { screenX: 0, screenY: 500, width: 400, height: 300 } });
  });
  expect(StyleSheet.flatten(screen.getByTestId("app-keyboard").props.style).paddingBottom).toBe(300);
  await act(() => {
    DeviceEventEmitter.emit("keyboardDidHide", null);
  });
  expect(StyleSheet.flatten(screen.getByTestId("app-keyboard").props.style).paddingBottom).toBe(0);
});
