import { useFonts } from "expo-font";

import { fontFamily } from "./typography";

/**
 * Loads the Poppins family. Every typography variant names one of these files
 * directly, because React Native cannot synthesise weights for custom fonts.
 * Until this resolves, App renders nothing — text would flash in the system
 * font and reflow once Poppins arrives.
 */
export const useAppFonts = (): boolean => {
  const [loaded] = useFonts({
    [fontFamily.regular]: require("../../assets/fonts/Poppins-Regular.ttf"),
    [fontFamily.medium]: require("../../assets/fonts/Poppins-Medium.ttf"),
    [fontFamily.semibold]: require("../../assets/fonts/Poppins-SemiBold.ttf"),
    [fontFamily.bold]: require("../../assets/fonts/Poppins-Bold.ttf"),
    [fontFamily.black]: require("../../assets/fonts/Poppins-Black.ttf"),
  });
  return loaded;
};
