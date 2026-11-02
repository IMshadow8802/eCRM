import { Platform } from "react-native";
import Constants from "expo-constants";

/** From app.config.ts as built (version + the date-stamped build number), never a literal. */
export function appVersion(): string {
  const config = Constants.expoConfig;
  if (!config?.version) return "Nexus CRM";
  const build = Platform.OS === "android" ? config.android?.versionCode : config.ios?.buildNumber;
  return `Nexus CRM · v${config.version}${build ? ` (${build})` : ""}`;
}
