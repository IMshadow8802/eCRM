import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Check, type LucideIcon } from "lucide-react-native";

import { chipTones, colors, elevation, fontFamily, HIT_TARGET, metrics, radius, spacing, type ChipTone } from "../theme";
import { CountPill } from "./CountBadge";
import { Text } from "./Text";

export interface TabOption<T> {
  value: T;
  label: string;
  count?: number;
  countTone?: "danger";
  icon?: LucideIcon;
}

// ------------------------------------------------------------------ BandTabs

export interface BandTabsProps<T> {
  value: T;
  options: TabOption<T>[];
  onChange: (v: T) => void;
  /** Space-between instead of gap 22 (Complaints, Leads, T2). */
  spread?: boolean;
  /** 13/600 labels (Complaints); default 14/600. */
  size?: "md" | "sm";
  testID?: string;
}

/**
 * Underline tabs on the band (E `.seg`): muted labels, the active one white
 * over a 3 px indicator its full width. The row scrolls sideways when it does
 * not fit — Complaints and Leads carry a fifth preset, Unassigned (§7.1).
 */
export function BandTabs<T extends string | number>({ value, options, onChange, spread = false, size = "md", testID }: BandTabsProps<T>) {
  const [content, setContent] = useState(0);
  const [box, setBox] = useState(0);
  // Only a row wider than its box scrolls; one that fits keeps spread/gap layout.
  const overflow = box > 0 && content > box + 1;
  const items = options.map((o) => {
    const on = o.value === value;
    return (
      <Pressable
        key={String(o.value)}
        onPress={() => onChange(o.value)}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={o.count != null ? `${o.label}, ${o.count}` : o.label}
        style={({ pressed }) => [styles.bandTab, pressed && styles.sink]}
      >
        <Text variant={size === "sm" ? "metaStrong" : "tab"} scaleCap="chrome" color={on ? "textOnBrand" : "onBandMuted"}>
          {o.label}
        </Text>
        {o.count != null ? <CountPill count={o.count} tone={o.countTone ?? (on ? "active" : "default")} /> : null}
        {on ? <View testID="band-tab-indicator" style={styles.indicator} /> : null}
      </Pressable>
    );
  });
  const row = [styles.bandRow, spread && !overflow ? styles.spread : styles.gap22];
  return (
    <ScrollView
      horizontal
      testID={testID}
      accessibilityRole="tablist"
      showsHorizontalScrollIndicator={false}
      scrollEnabled={overflow}
      onLayout={(e: LayoutChangeEvent) => setBox(e.nativeEvent.layout.width)}
      onContentSizeChange={(w) => setContent(w)}
      contentContainerStyle={[row, !overflow && styles.fill]}
    >
      {items}
    </ScrollView>
  );
}

// ------------------------------------------------------------- SegmentedTabs

export interface SegmentedTabsProps<T> {
  value: T;
  options: TabOption<T>[];
  onChange: (v: T) => void;
  /** `inSheet`: field-tint outer, no shadow (24, T4). */
  tone?: "card" | "inSheet";
  /** Padding 3, gap 2 (16). */
  compact?: boolean;
  /** 36 tall segments (T4). */
  tall?: boolean;
  testID?: string;
}

/**
 * The pill segmented control on the sheet (E `.sgp`): the active segment is
 * solid primary with white text. Past four segments it scrolls at natural width.
 */
export function SegmentedTabs<T extends string | number>({
  value, options, onChange, tone = "card", compact = false, tall = false, testID,
}: SegmentedTabsProps<T>) {
  const scroll = options.length > 4;
  const height = tall ? metrics.segmentHeightTall : metrics.segmentHeight;
  const segments = options.map((o) => {
    const on = o.value === value;
    const ink = on ? colors.textOnBrand : colors.textSecondary;
    return (
      <Pressable
        key={String(o.value)}
        onPress={() => onChange(o.value)}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={o.count != null ? `${o.label}, ${o.count}` : o.label}
        hitSlop={(HIT_TARGET - height) / 2}
        style={({ pressed }) => [
          styles.segment,
          { height, borderRadius: height / 2 },
          scroll ? styles.natural : styles.flex,
          on && styles.segmentOn,
          pressed && styles.sink,
        ]}
      >
        {o.icon ? <o.icon size={16} color={ink} /> : null}
        <Text variant="metaStrong" color={on ? "textOnBrand" : "textSecondary"} numberOfLines={1}>
          {o.label}
        </Text>
        {o.count != null ? (
          o.countTone === "danger" ? (
            <CountPill count={o.count} tone="danger" />
          ) : (
            <Text variant="metaStrong" tabular color={on ? "textOnBrand" : "textSecondary"} style={styles.bold}>
              {o.count}
            </Text>
          )
        ) : null}
      </Pressable>
    );
  });
  const outer = [
    styles.segOuter,
    compact && styles.segCompact,
    tone === "inSheet" ? styles.inSheet : elevation.whisper,
  ];
  if (!scroll) {
    return <View testID={testID} accessibilityRole="tablist" style={outer}>{segments}</View>;
  }
  return (
    <View testID={testID} style={outer}>
      <ScrollView horizontal accessibilityRole="tablist" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segScroll}>
        {segments}
      </ScrollView>
    </View>
  );
}

// --------------------------------------------------------------- FilterPills

export interface FilterOption<T> {
  value: T;
  label: string;
  count?: number;
  tone?: ChipTone;
  icon?: LucideIcon;
}

export interface FilterPillsProps<T> {
  value: T | null;
  options: FilterOption<T>[];
  onChange: (v: T) => void;
  /** `sheet`: 34 tall pills (in a bottom sheet); `inSheet` also tints idle pills. */
  tone?: "page" | "sheet" | "inSheet";
  /** Wrap instead of scrolling (transfer reasons, 23); the active pill gets a check. */
  wrap?: boolean;
  /** Names the group for screen readers. */
  label?: string;
  testID?: string;
}

/**
 * The pill row with counts on the sheet (E `.pills`): idle white + whisper,
 * a toned pill in its chip colours, the active one solid primary. Scrolls
 * sideways and bleeds to the right edge.
 */
export function FilterPills<T extends string | number>({
  value, options, onChange, tone = "page", wrap = false, label, testID,
}: FilterPillsProps<T>) {
  const height = tone === "page" ? metrics.pillHeight : metrics.pillHeightSheet;
  const pills = options.map((o) => {
    const on = o.value === value;
    const toned = o.tone ? chipTones[o.tone] : null;
    const fill = on ? colors.primary : toned ? toned.fill : tone === "inSheet" ? colors.fieldTint : colors.surface;
    const ink = on ? colors.textOnBrand : toned ? toned.text : colors.textSecondary;
    const shadow = !on && !toned && tone === "page";
    return (
      <Pressable
        key={String(o.value)}
        onPress={() => onChange(o.value)}
        accessibilityRole="radio"
        accessibilityState={{ selected: on, checked: on }}
        accessibilityLabel={o.count != null ? `${o.label}, ${o.count}` : o.label}
        hitSlop={(HIT_TARGET - height) / 2}
        style={({ pressed }) => [
          styles.pill,
          { height, borderRadius: height / 2, backgroundColor: fill },
          shadow && elevation.whisper,
          pressed && styles.sink,
        ]}
      >
        {wrap && on ? <Check size={14} color={ink} /> : o.icon ? <o.icon size={14} color={ink} /> : null}
        <Text variant="metaStrong" style={{ color: ink }} numberOfLines={1}>{o.label}</Text>
        {o.count != null ? <Text variant="metaStrong" tabular style={[styles.bold, { color: ink }]}>{o.count}</Text> : null}
      </Pressable>
    );
  });
  if (wrap) {
    return <View testID={testID} accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.pillWrap}>{pills}</View>;
  }
  return (
    <ScrollView
      horizontal
      testID={testID}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      showsHorizontalScrollIndicator={false}
      style={styles.bleed}
      contentContainerStyle={styles.pillRow}
    >
      {pills}
    </ScrollView>
  );
}

/** The loading stand-in for a pill row (20b): solid blocks, no shimmer. */
export function FilterPillsSkeleton() {
  return (
    <View style={styles.pillRow} testID="pills-skeleton">
      {[60, 76, 92, 96].map((w) => (
        <View key={w} style={[styles.pillSkeleton, { width: w }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bandRow: { height: metrics.bandTabHeight, flexDirection: "row", alignItems: "stretch" },
  fill: { flexGrow: 1 },
  gap22: { gap: 22 },
  spread: { justifyContent: "space-between" },
  bandTab: { flexDirection: "row", alignItems: "center", gap: metrics.inlineGap },
  indicator: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: colors.bandMark,
    borderTopLeftRadius: radius.mark,
    borderTopRightRadius: radius.mark,
  },
  sink: { transform: [{ scale: 0.97 }] },
  segOuter: { flexDirection: "row", gap: spacing[1], padding: spacing[1], borderRadius: radius.sheet, backgroundColor: colors.surface },
  segCompact: { padding: 3, gap: 2 },
  inSheet: { backgroundColor: colors.fieldTint },
  segScroll: { gap: spacing[1] },
  segment: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: metrics.inlineGap },
  flex: { flex: 1 },
  natural: { paddingHorizontal: 14 },
  segmentOn: { backgroundColor: colors.primary },
  bold: { fontFamily: fontFamily.bold },
  bleed: { marginRight: -metrics.gutter },
  pillRow: { flexDirection: "row", gap: spacing[2], paddingRight: metrics.gutter },
  pillWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  pill: { flexDirection: "row", alignItems: "center", gap: metrics.inlineGap, paddingHorizontal: spacing[3] },
  pillSkeleton: { height: metrics.pillHeight, borderRadius: radius.card, backgroundColor: colors.skeleton },
});
