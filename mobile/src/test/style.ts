import { StyleSheet, type TextStyle, type ViewStyle } from "react-native";

export type FlatStyle = ViewStyle & TextStyle & { boxShadow?: string };

/** The flattened style of a rendered host element (or anything with `props.style`). */
export const flat = (el: { props: Record<string, unknown> } | null | undefined): FlatStyle =>
  (StyleSheet.flatten(el?.props.style as never) ?? {}) as FlatStyle;
