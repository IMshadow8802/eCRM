import { Platform } from "react-native";
import Constants from "expo-constants";

import { appVersion } from "./appVersion";

// Only `expoConfig` is replaced: its getter is not configurable, so no spyOn.
const mockExpo: { config: Partial<NonNullable<typeof Constants.expoConfig>> | null } = { config: null };
jest.mock("expo-constants", () => {
  const actual = jest.requireActual("expo-constants");
  return {
    ...actual,
    __esModule: true,
    default: new Proxy(actual.default, {
      get: (target, key) => (key === "expoConfig" ? mockExpo.config : Reflect.get(target, key)),
    }),
  };
});

const os = Platform.OS;
afterEach(() => {
  Platform.OS = os;
});

it("reads the version and the platform's build number", () => {
  mockExpo.config = { version: "1.0.1", ios: { buildNumber: "20261102" }, android: { versionCode: 20261103 } };
  Platform.OS = "ios";
  expect(appVersion()).toBe("Nexus CRM · v1.0.1 (20261102)");
  Platform.OS = "android";
  expect(appVersion()).toBe("Nexus CRM · v1.0.1 (20261103)");
});

it("no build number, the version alone; no config, the name alone", () => {
  mockExpo.config = { version: "1.0.1" };
  expect(appVersion()).toBe("Nexus CRM · v1.0.1");
  mockExpo.config = null;
  expect(appVersion()).toBe("Nexus CRM");
});
