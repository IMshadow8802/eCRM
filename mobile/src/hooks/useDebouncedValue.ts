import { useEffect, useState } from "react";

/**
 * `value`, once it has stopped changing for `delayMs`. A search box uses it so
 * a burst of typing is one request, not one per key.
 *
 * Clearing (`""`) applies at once: an emptied search box should show the full
 * list now, not after a pause.
 */
export function useDebouncedValue<T extends string>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);
  // Set during render, not in the effect, so the cleared value is what this
  // very render returns. React re-renders before committing.
  if (value === "" && settled !== value) setSettled(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
