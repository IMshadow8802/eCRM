import { forwardRef } from "react";
import type { TextInput } from "react-native";

import { normalizeMobile } from "../utils/mobile";
import { Input, type InputProps } from "./Input";

export interface MobileInputProps
  extends Omit<InputProps, "onChangeText" | "maxLength" | "keyboardType"> {
  /** Receives the cleaned digits, never the raw text. */
  onChangeText?: (digits: string) => void;
}

/**
 * The one mobile-number field (web: ui/MobileInput). No `maxLength`, on
 * purpose: the OS truncates a paste to it before any handler runs, so a pasted
 * "+91 98250 12345" would land as "9198250123" — a wrong number that is still
 * ten digits. Instead the text is cleaned on every change; whatever is not ten
 * digits afterwards is handed back as typed and the server's 400 says so.
 */
export const MobileInput = forwardRef<TextInput, MobileInputProps>(function MobileInput(
  { onChangeText, placeholder = "10-digit number", prefix = "+91", ...rest },
  ref,
) {
  return (
    <Input
      ref={ref}
      placeholder={placeholder}
      prefix={prefix}
      tabular
      keyboardType="phone-pad"
      autoComplete="tel"
      {...rest}
      onChangeText={(text) => {
        const digits = text.replace(/\D/g, "");
        onChangeText?.(normalizeMobile(digits) ?? digits);
      }}
    />
  );
});
