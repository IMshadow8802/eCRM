import { useState } from "react";

/**
 * A list's filter, seeded from a route param and re-seeded by every navigate()
 * that brings one — Home's "Overdue" row must land on Overdue even when the
 * tab is already mounted and the user has since picked another queue.
 *
 * Compared by the params object, not the value: each navigate() hands over a
 * fresh object, so tapping the same Home row twice still re-applies it.
 * Adjusting state during render is React's own pattern for this (no effect,
 * no flash of the old filter).
 */
export function useParamState<T>(params: object | undefined, value: T | undefined, fallback: T) {
  const [state, setState] = useState<T>(value ?? fallback);
  const [seen, setSeen] = useState(params);
  if (params !== seen) {
    setSeen(params);
    if (value !== undefined) setState(value);
  }
  return [state, setState] as const;
}
