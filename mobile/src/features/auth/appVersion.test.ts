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

// E 01/19: "Nexus CRM · v1.0.0" — the version only, never the build number.
it("reads the version from the build's config, without the build number", () => {
  mockExpo.config = { version: "1.0.1", ios: { buildNumber: "20261102" }, android: { versionCode: 20261103 } };
  expect(appVersion()).toBe("Nexus CRM · v1.0.1");
});

it("no config, the name alone", () => {
  mockExpo.config = null;
  expect(appVersion()).toBe("Nexus CRM");
});
