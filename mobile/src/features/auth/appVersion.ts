import Constants from "expo-constants";

/** E 01/19: "Nexus CRM · v{version}" from app.config.ts as built, never a literal; no build number. */
export function appVersion(): string {
  const version = Constants.expoConfig?.version;
  return version ? `Nexus CRM · v${version}` : "Nexus CRM";
}
