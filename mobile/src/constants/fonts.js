import { useFonts } from "expo-font";

// Font family mappings for TTF files
export const FontFamily = {
  regular: "Poppins-Regular",
  medium: "Poppins-Medium",
  semibold: "Poppins-SemiBold",
  bold: "Poppins-Bold",
  black: "Poppins-Black",
};

// Custom hook to load TTF fonts
export const useAppFonts = () => {
  const [fontsLoaded] = useFonts({
    "Poppins-Regular": require("../../assets/fonts/Poppins-Regular.ttf"),
    "Poppins-Medium": require("../../assets/fonts/Poppins-Medium.ttf"),
    "Poppins-SemiBold": require("../../assets/fonts/Poppins-SemiBold.ttf"),
    "Poppins-Bold": require("../../assets/fonts/Poppins-Bold.ttf"),
    "Poppins-Black": require("../../assets/fonts/Poppins-Black.ttf"),
  });

  return fontsLoaded;
};

// Get font family name based on weight
export const getFontFamily = (weight = "regular") => {
  return FontFamily[weight] || FontFamily.regular;
};

export default FontFamily;
