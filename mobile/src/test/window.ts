import { Dimensions } from "react-native";

/**
 * Sets the window jest renders into. RN's jest preset reports 750 × 1334,
 * which `useLayout` reads as a medium tablet (rail), so phone tests pin E's
 * 390 × 844 and tablet tests E's 1194 × 834. Reset after each test.
 */
export function setWindow(width: number, height: number) {
  const size = { width, height, scale: 2, fontScale: 1 };
  Dimensions.set({ window: size, screen: size });
}

export const PHONE = [390, 844] as const;
export const TABLET = [1194, 834] as const;

const initial = Dimensions.get("window");
afterEach(() => {
  Dimensions.set({ window: initial, screen: initial });
});
