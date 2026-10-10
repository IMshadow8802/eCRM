import { useSyncExternalStore } from "react";

// How much the root font size has grown over the 15px design root (index.css).
// For things CSS rem cannot reach: chart libraries that take plain numbers
// (recharts heights, SVG tick font sizes). Multiply a design px value by it.
const read = () => parseFloat(getComputedStyle(document.documentElement).fontSize) / 15 || 1;

const subscribe = (onChange) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};

export default function useUiScale() {
  return useSyncExternalStore(subscribe, read, () => 1);
}

// The window's height, live. A chart above a fit-to-window table takes a
// share of it, so a 720p screen keeps room for the table instead of scrolling.
export function useViewportHeight() {
  return useSyncExternalStore(subscribe, () => window.innerHeight, () => 800);
}
