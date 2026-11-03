import { useEffect, useState } from "react";
import { Keyboard } from "react-native";

/**
 * The software keyboard's height, 0 while it is down. Android only reports
 * the Did events, so those are the ones listened to on both platforms.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(() => Keyboard.metrics()?.height ?? 0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

/** True while the software keyboard is up. */
export default function useKeyboardOpen(): boolean {
  return useKeyboardHeight() > 0;
}
