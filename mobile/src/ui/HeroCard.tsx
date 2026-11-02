import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ArrowRight, type LucideIcon } from "lucide-react-native";

import { badgeTones, colors, metrics, moduleIcons, moduleTones, radius, spacing, type UiModule } from "../theme";
import { Text } from "./Text";

export interface HeroStat {
  label: string;
  /** undefined renders "—": only a real reply may say a number. */
  value: number | string | undefined;
  /** Overdue: the warm figure on indigo. */
  warn?: boolean;
  /** Each stat opens exactly what it counts. */
  onPress?: () => void;
}

export interface HeroCardProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  onOpen?: () => void;
  /** Right of the title (09's state chip); takes the Open link's place. */
  right?: ReactNode;
  stats?: HeroStat[];
  children?: ReactNode;
  size?: "phone" | "tablet";
}

/**
 * The indigo stat hero (E `.hero`, 04 / 27 / T1): a white circle icon, a
 * title, an "Open" link and up to four tappable figures.
 */
export function HeroCard({ icon: Icon, title, subtitle, onOpen, right, stats, children, size = "phone" }: HeroCardProps) {
  const tablet = size === "tablet";
  return (
    <View style={[styles.hero, tablet && styles.heroTablet]}>
      <View style={styles.head}>
        <View style={styles.wc}>
          <Icon size={20} color={colors.primary} />
        </View>
        <View style={styles.flex}>
          <Text variant={tablet ? "h2" : "cardTitle"} color="textOnBrand" numberOfLines={1}>{title}</Text>
          {subtitle ? <Text variant="meta" color="onBrandMuted" numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {right ?? null}
        {onOpen && !right ? (
          <Pressable onPress={onOpen} hitSlop={12} accessibilityRole="link" accessibilityLabel={`Open ${title}`} style={styles.open}>
            <Text variant="metaStrong" color="textOnBrand">Open</Text>
            <ArrowRight size={16} color={colors.textOnBrand} />
          </Pressable>
        ) : null}
      </View>
      {stats?.length ? <StatGrid stats={stats} size={size} /> : null}
      {children}
    </View>
  );
}

/** Four equal figures on the hero: label 12/500, value 32 (tablet 40). */
export function StatGrid({ stats, size = "phone" }: { stats: HeroStat[]; size?: "phone" | "tablet" }) {
  return (
    <View style={[styles.grid, size === "tablet" && styles.gridTablet]}>
      {stats.map((s) => {
        const value = s.value == null ? "—" : String(s.value);
        const body = (
          <>
            <Text variant="smallMedium" color="onBrandMuted" numberOfLines={1}>{s.label}</Text>
            <Text variant={size === "tablet" ? "statLg" : "stat"} color={s.warn ? "onBrandWarn" : "textOnBrand"}>{value}</Text>
          </>
        );
        return s.onPress ? (
          <Pressable key={s.label} onPress={s.onPress} accessibilityRole="button" accessibilityLabel={`${s.label} ${value}`} style={styles.stat}>
            {body}
          </Pressable>
        ) : (
          <View key={s.label} style={styles.stat}>{body}</View>
        );
      })}
    </View>
  );
}

/** The two-figure box on the deadline hero (09): Target | Over by. */
export function FigureBox({ figures }: { figures: { label: string; value: string; warn?: boolean }[] }) {
  return (
    <View style={styles.figureBox}>
      {figures.map((f, i) => (
        <View key={f.label} style={styles.figureRow}>
          {i > 0 ? <View testID="figure-divider" style={styles.divider} /> : null}
          <View style={styles.figure}>
            <Text variant="smallMedium" color="onBrandMuted">{f.label}</Text>
            <Text variant="figure" color={f.warn ? "onBrandWarn" : "textOnBrand"}>{f.value}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** The used / overrun bar on the deadline hero: white then salmon on indigo-pressed. */
export function SplitBar({ used, overrun = 0 }: { used: number; overrun?: number }) {
  const clamp = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
  const u = clamp(used);
  const o = Math.min(clamp(overrun), 1 - u);
  return (
    <View style={styles.split} accessibilityLabel={`${Math.round(u * 100)}% used`}>
      <View testID="split-used" style={[styles.splitUsed, { flex: u }]} />
      {o > 0 ? <View testID="split-overrun" style={[styles.splitOver, { flex: o }]} /> : null}
      <View style={{ flex: 1 - u - o }} />
    </View>
  );
}

export interface ModuleTileProps {
  module: UiModule;
  title: string;
  subtitle?: string;
  /** undefined = still loading: a skeleton block, never a 0. */
  value: number | undefined;
  unit: string;
  onPress: () => void;
  size?: "phone" | "tablet";
}

/** A module-colour bento tile (E `.tile`): title, value + unit, "Open". */
export function ModuleTile({ module, title, subtitle, value, unit, onPress, size = "phone" }: ModuleTileProps) {
  const { fill, ink } = badgeTones[moduleTones[module].badge];
  const Icon = moduleIcons[module].tile;
  const tablet = size === "tablet";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${value ?? "loading"} ${unit}`}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: fill, height: tablet ? metrics.tileHeightTablet : metrics.tileHeight },
        tablet && styles.tileTablet,
        pressed && styles.sink,
      ]}
    >
      <View style={styles.tileHead}>
        <View style={styles.flex}>
          <Text variant="bodyStrong" style={{ color: ink }} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text variant="smallMedium" style={{ color: ink }} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        <View style={[styles.wc, styles.wc36]}>
          <Icon size={18} color={ink} />
        </View>
      </View>
      <View style={styles.tileValue}>
        {value == null ? (
          <View testID="tile-skeleton" style={styles.tileSkeleton} />
        ) : (
          <Text variant="tileValue" style={{ color: ink }}>{String(value)}</Text>
        )}
        <Text variant="metaMedium" style={[styles.flex, { color: ink }]} numberOfLines={1}>{unit}</Text>
      </View>
      <View style={styles.tileFoot}>
        <Text variant="metaStrong" style={{ color: ink }}>Open</Text>
        <ArrowRight size={16} color={ink} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.primary, borderRadius: radius.sheet, paddingTop: 14, paddingHorizontal: spacing[4], paddingBottom: spacing[3] },
  heroTablet: { paddingTop: 18, paddingHorizontal: spacing[5], paddingBottom: spacing[4] },
  head: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  wc: {
    width: metrics.iconButton,
    height: metrics.iconButton,
    borderRadius: metrics.iconButton / 2,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  wc36: { width: 36, height: 36, borderRadius: 18 },
  flex: { flex: 1, minWidth: 0 },
  open: { flexDirection: "row", alignItems: "center", gap: 4 },
  grid: { flexDirection: "row", marginTop: spacing[3] },
  gridTablet: { marginTop: spacing[4] },
  stat: { flex: 1 },
  figureBox: { flexDirection: "row", marginTop: spacing[3], paddingVertical: 10, borderRadius: radius.badgeLg, backgroundColor: colors.primaryPressed },
  figureRow: { flex: 1, flexDirection: "row" },
  figure: { flex: 1, alignItems: "center" },
  divider: { width: 1, backgroundColor: colors.onBrandDivider },
  split: { flexDirection: "row", gap: 2, height: 8, borderRadius: 4, marginTop: spacing[3], overflow: "hidden", backgroundColor: colors.primaryPressed },
  splitUsed: { backgroundColor: colors.surface },
  splitOver: { backgroundColor: colors.onBrandOverrun },
  tile: { borderRadius: radius.sheet, paddingTop: spacing[3], paddingRight: spacing[3], paddingBottom: 10, paddingLeft: 14 },
  tileTablet: { padding: spacing[4] },
  sink: { transform: [{ scale: 0.97 }] },
  tileHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2] },
  tileValue: { flexDirection: "row", alignItems: "baseline", gap: metrics.inlineGap, marginTop: "auto" },
  tileSkeleton: { width: 28, height: 32, borderRadius: radius.badgeXs, backgroundColor: colors.skeleton },
  tileFoot: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 2 },
});
