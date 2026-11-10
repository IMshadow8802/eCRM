import { StyleSheet, View } from "react-native";

import { colors, metrics, radius } from "../theme";

export interface ProgressBarProps {
  /** 0–1; clamped. */
  value: number;
  /** `lg` is the 8 dp checklist header bar; `md` the 6 dp row bar. */
  size?: "md" | "lg";
  /** Fixed width (40 on a task row); omit to fill the row. */
  width?: number;
}

/** A solid track with a solid fill (E `.bar`). */
export function ProgressBar({ value, size = "md", width }: ProgressBarProps) {
  const height = metrics.progress[size];
  const pct = Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 100);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={[styles.track, { height, borderRadius: height / 2 }, width != null ? { width } : styles.fill]}
    >
      <View style={[styles.bar, { width: `${pct}%`, height, borderRadius: height / 2 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { backgroundColor: colors.track, overflow: "hidden", borderRadius: radius.mark },
  fill: { alignSelf: "stretch" },
  bar: { backgroundColor: colors.primary },
});
