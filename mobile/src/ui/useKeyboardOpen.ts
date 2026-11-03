import { useEffect, useState } from "react";
import { Keyboard } from "react-native";

/**
 * True while the software keyboard is up. Android only reports the Did events,
 * so those are the ones listened to on both platforms.
 */
export default function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setOpen(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}
