import { useWindowDimensions } from "react-native";

import { metrics } from "../theme";

export type SizeClass = "compact" | "medium" | "expanded";

export interface Layout {
  sizeClass: SizeClass;
  width: number;
  height: number;
  isLandscape: boolean;
  nav: "bar" | "rail";
  /** List and detail side by side (Complaints, Leads). */
  isTwoPane: boolean;
  /** Max width of a form card (and of a list at medium). */
  contentMaxWidth: number;
  /** Home grid columns. */
  columns: 1 | 2 | 3;
  /** Band and sheet horizontal padding. */
  gutter: number;
}

const MEDIUM = 600;
const EXPANDED = 840;
/** Below this height a landscape phone would squeeze two panes into 390 dp: cap at medium. */
const SHORT = 480;
/** The detail pane needs this much once the rail and the 420 list are taken (rule 5). */
const MIN_DETAIL = 480;

/**
 * The size class and what it means for the shell (spec §2.1). Pure, so every
 * breakpoint is a unit test rather than an emulator session. Larger screens
 * get more columns and panes, never bigger type.
 */
export function layoutFor(width: number, height: number): Layout {
  let sizeClass: SizeClass = width >= EXPANDED ? "expanded" : width >= MEDIUM ? "medium" : "compact";
  if (height < SHORT && sizeClass === "expanded") sizeClass = "medium";
  const base = { width, height, isLandscape: width > height };
  if (sizeClass === "compact") {
    return { ...base, sizeClass, nav: "bar", isTwoPane: false, contentMaxWidth: width, columns: 2, gutter: metrics.gutter };
  }
  const isTwoPane =
    sizeClass === "expanded" && width - metrics.railWidth - metrics.listPaneWidth >= MIN_DETAIL;
  return {
    ...base,
    sizeClass,
    nav: "rail",
    isTwoPane,
    contentMaxWidth: metrics.formMaxWidth,
    columns: sizeClass === "expanded" ? 3 : 2,
    gutter: sizeClass === "expanded" ? metrics.gutterExpanded : metrics.gutterMedium,
  };
}

/** Tablet geometry (60 band row, 20/24 sheet overlap) follows the rail: one predicate for Band and BandSheet. */
export const isTabletLayout = (layout: Layout) => layout.nav === "rail";

/** `layoutFor` on the live window; re-renders on rotation and split screen. */
export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  return layoutFor(width, height);
}
