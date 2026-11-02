import { StatusBar as RNStatusBar } from "react-native";
import { render } from "@testing-library/react-native";

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
    return <Band title="Today" />;
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
