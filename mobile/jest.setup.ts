import "react-native-gesture-handler/jestSetup";
import { notifyManager } from "@tanstack/react-query";

// React Query batches observer notifications on a setTimeout(0), which can fire
// after a test's last act()/waitFor and log "not wrapped in act". Synchronous
// notifications land inside whichever act() resolved the query.
notifyManager.setScheduler((cb) => cb());

jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));
jest.mock("@gorhom/bottom-sheet", () => require("@gorhom/bottom-sheet/mock"));
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// No native WebView in jest; a plain View keeps its props for assertions.
jest.mock("react-native-webview", () => {
  const { View } = require("react-native");
  return { __esModule: true, WebView: View, default: View };
});

// The pickers are native UIs: by default the user backs out. A test that needs
// a file overrides the resolved value; the beforeEach below puts the default
// back, because clearMocks keeps an override alive into the next test.
const mockCanceled = async () => ({ canceled: true, assets: null });
const mockGranted = async () => ({ granted: true, status: "granted", canAskAgain: true, expires: "never" });
jest.mock("expo-document-picker", () => ({
  getDocumentAsync: jest.fn(mockCanceled),
}));
jest.mock("expo-image-picker", () => ({
  ...jest.requireActual("expo-image-picker"),
  requestCameraPermissionsAsync: jest.fn(mockGranted),
  requestMediaLibraryPermissionsAsync: jest.fn(mockGranted),
  launchCameraAsync: jest.fn(mockCanceled),
  launchImageLibraryAsync: jest.fn(mockCanceled),
}));

beforeEach(() => {
  const rearm = (fn: jest.Mock, impl: () => Promise<unknown>) => fn.mockReset().mockImplementation(impl);
  const documents = jest.requireMock<Record<string, jest.Mock>>("expo-document-picker");
  const images = jest.requireMock<Record<string, jest.Mock>>("expo-image-picker");
  rearm(documents.getDocumentAsync!, mockCanceled);
  rearm(images.requestCameraPermissionsAsync!, mockGranted);
  rearm(images.requestMediaLibraryPermissionsAsync!, mockGranted);
  rearm(images.launchCameraAsync!, mockCanceled);
  rearm(images.launchImageLibraryAsync!, mockCanceled);
});

// The native picker; a plain View so a test can fire its `change` event.
jest.mock("@react-native-community/datetimepicker", () => {
  const { View } = require("react-native");
  return { __esModule: true, default: View };
});
