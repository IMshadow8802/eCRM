import { forwardRef } from "react";
import TextInput from "./TextInput";
import { normalizeMobile } from "../../utils/mobile";

// Digits only, ten of them — capped HERE, not with a maxlength attribute: a
// browser truncates a paste to maxlength before any handler runs. A pasted "+91 98250 12345" or "098250 12345" loses
// its PREFIX, not its tail — naively cutting to the first ten characters keeps
// the country code and throws away the end of the number. Which prefixes come
// off is NOT decided here: normalizeMobile owns that rule, and there is no
// second copy of it. Anything it refuses is still being typed, so the digits so
// far are handed back, capped at ten.
const clean = (raw) => {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return normalizeMobile(digits) ?? digits.slice(0, 10);
};

/**
 * The one mobile-number field. Same props as TextInput, except `onChange`
 * receives the CLEANED STRING rather than an event — every caller wants the
 * digits, and handing over an event would make each of them strip it again.
 * The rule itself (and its enforcement) lives in utils/mobile + the backend.
 */
const MobileInput = forwardRef(function MobileInput({ onChange, ...rest }, ref) {
  return (
    <TextInput
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="tel-national"
      placeholder="10-digit mobile"
      {...rest}
      onChange={(e) => onChange?.(clean(e.target.value))}
    />
  );
});

export default MobileInput;
