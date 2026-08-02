import { useFonts } from "expo-font";

import { fontFamily } from "./typography";

/**
 * Loads the Inter family. Every typography variant names one of these files
 * directly, because React Native cannot synthesise weights for custom fonts.
 * Until this resolves, App renders nothing — text would flash in the system
 * font and reflow once Inter arrives.
 *
 * The .ttf files are committed under assets/fonts/ rather than pulled from
 * `@expo-google-fonts/inter`: they are also referenced by path in
 * app.config.ts, where the expo-font plugin embeds them natively at prebuild.
 * A node_modules path in native config would break the moment the package
 * layout changed.
 */
export const useAppFonts = (): boolean => {
  const [loaded] = useFonts({
    [fontFamily.regular]: require("../../assets/fonts/Inter_400Regular.ttf"),
    [fontFamily.medium]: require("../../assets/fonts/Inter_500Medium.ttf"),
    [fontFamily.semibold]: require("../../assets/fonts/Inter_600SemiBold.ttf"),
    [fontFamily.bold]: require("../../assets/fonts/Inter_700Bold.ttf"),
    [fontFamily.black]: require("../../assets/fonts/Inter_900Black.ttf"),
  });
  return loaded;
};
