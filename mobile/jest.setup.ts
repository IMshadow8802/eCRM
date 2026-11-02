import "react-native-gesture-handler/jestSetup";

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
// a file overrides the resolved value.
jest.mock("expo-document-picker", () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));
jest.mock("expo-image-picker", () => {
  const granted = async () => ({ granted: true, status: "granted", canAskAgain: true, expires: "never" });
  const canceled = async () => ({ canceled: true, assets: null });
  return {
    ...jest.requireActual("expo-image-picker"),
    requestCameraPermissionsAsync: jest.fn(granted),
    requestMediaLibraryPermissionsAsync: jest.fn(granted),
    launchCameraAsync: jest.fn(canceled),
    launchImageLibraryAsync: jest.fn(canceled),
  };
});

// The native picker; a plain View so a test can fire its `change` event.
jest.mock("@react-native-community/datetimepicker", () => {
  const { View } = require("react-native");
  return { __esModule: true, default: View };
});
