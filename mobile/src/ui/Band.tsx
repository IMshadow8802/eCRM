import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, X } from "lucide-react-native";

import { colors, metrics, radius } from "../theme";
import { IconButton } from "./IconButton";
import { KeyboardScrollView } from "./KeyboardScrollView";
import { Refresher, type RefresherProps } from "./Refresher";
import { SearchField, type SearchFieldProps } from "./SearchField";
import { BandTabs, type BandTabsProps } from "./Tabs";
import { Text } from "./Text";
import { isTabletLayout, useLayout } from "./useLayout";

export type BandVariant = "tabs" | "home" | "record" | "profile";

export interface BandProps {
  title?: string;
  /** `h1` list/screen title (default) or `h2` record id with a subtitle under it. */
  titleVariant?: "h1" | "h2";
  /** Under an h2 title; or, with no title, the row's lead ("Sales Ops · In Progress"). */
  subtitle?: string;
  /** Baseline count after an h1 title ("12 yours"). */
  count?: string;
  onBack?: () => void;
  /** `close` = an X, for forms. */
  backIcon?: "back" | "close";
  /** IconButtons and/or a HeaderButton, right of the title. */
  actions?: ReactNode;
  search?: SearchFieldProps;
  tabs?: BandTabsProps<string>;
  /** Picks the bottom padding: tabs 16 · home 28 · record 30 · profile 36. */
  variant?: BandVariant;
  /** `raised` = the tablet detail pane (Navy 800). */
  tone?: "band" | "raised";
  /** `center` = profile (avatar and name centred). */
  align?: "start" | "center";
  /** Extra content under the row: record title, chip row, the Home shift row. */
  children?: ReactNode;
  /** Set when the band does not touch the top of the screen (tablet pane under the status bar is still the band). */
  noInset?: boolean;
  /**
   * Leads the row after any back button (Home 04: avatar + date/greeting).
   * With no title or subtitle it replaces the title block, so it must flex itself.
   */
  leading?: ReactNode;
  /** Horizontal padding when it is not the window gutter (tablet panes, `metrics.pane`). */
  gutter?: number;
}

/**
 * The navy header (E `.hd`). It runs under the status bar (light content);
 * the sheet below overlaps its bottom edge by 16.
 */
export function Band({
  title, titleVariant = "h1", subtitle, count, onBack, backIcon = "back", actions, search, tabs,
  variant = "tabs", tone = "band", align = "start", children, noInset = false, leading, gutter,
}: BandProps) {
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const topInset = noInset ? 0 : insets.top;
  const tablet = isTabletLayout(layout);
  const rowHeight = tablet ? metrics.bandRowTablet : variant === "home" ? metrics.bandRowHome : metrics.bandRow;
  const bg = tone === "raised" ? colors.bandRaised : colors.band;

  // A centred profile band with nothing in the row draws no row (E 19: the avatar sits 16 under the status bar).
  const showRow = align !== "center" || !!(title || subtitle || onBack || actions || leading);
  const titleBlock =
    leading && !title && !subtitle ? null : title && titleVariant === "h2" ? (
      <View style={styles.flex}>
        <Text variant="h2" color="textOnBrand" numberOfLines={1} accessibilityRole="header">{title}</Text>
        {subtitle ? <Text variant="meta" color="onBandMuted" numberOfLines={1}>{subtitle}</Text> : null}
      </View>
    ) : title ? (
      <View style={[styles.flex, styles.baseline]}>
        <Text variant="h1" color="textOnBrand" numberOfLines={1} accessibilityRole="header" style={styles.shrink}>{title}</Text>
        {count ? <Text variant="meta" color="onBandMuted" numberOfLines={1}>{count}</Text> : null}
      </View>
    ) : (
      <Text variant="meta" color="onBandMuted" numberOfLines={1} style={styles.flex}>{subtitle ?? ""}</Text>
    );

  return (
    <View
      style={[

        {
          backgroundColor: bg,
          paddingTop: topInset,
          paddingHorizontal: gutter ?? layout.gutter,
          paddingBottom: metrics.bandPadBottom[variant],
        },
        align === "center" && styles.center,
      ]}
    >
      <StatusBar style="light" />
      {showRow ? (
      <View style={[styles.row, { height: rowHeight }, align === "center" && styles.rowCenter]}>
        {onBack ? (
          <IconButton
            variant="ghost"
            icon={backIcon === "close" ? X : ChevronLeft}
            accessibilityLabel={backIcon === "close" ? "Close" : "Go back"}
            onPress={onBack}
          />
        ) : null}
        {leading}
        {align === "center" && !title ? <View style={styles.flex} /> : titleBlock}
        {actions}
      </View>
      ) : null}
      {search ? <SearchField {...search} /> : null}
      {tabs ? (
        <View style={styles.tabs}>
          <BandTabs {...tabs} />
        </View>
      ) : null}
      {children}
    </View>
  );
}

export interface BandSheetProps {
  children: ReactNode;
  /** Wraps the content in a ScrollView. */
  scroll?: boolean;
  refresh?: Pick<RefresherProps, "refreshing" | "onRefresh">;
  /** Off for content that pads itself (a FlatList with its own padding). */
  padded?: boolean;
  /** Board: padding 16 0 0 16, so columns bleed off the right edge. */
  bleedRight?: boolean;
  /** Empty state: centred, 96 from the top. */
  center?: boolean;
  /** Bottom room inside a scroll (a fixed footer or the keyboard). */
  contentBottom?: number;
  /** Side padding when it is not the window gutter (tablet panes, `metrics.pane`). */
  gutter?: number;
  style?: ViewStyle;
}

/**
 * The sheet over the band (E `.sheet`): the page colour, top corners 20,
 * pulled up 16 so the band shows behind its corners. It does not clip.
 */
export function BandSheet({
  children, scroll = false, refresh, padded = true, bleedRight = false, center = false, contentBottom = 0, gutter, style,
}: BandSheetProps) {
  const layout = useLayout();
  const tablet = isTabletLayout(layout);
  const side = gutter ?? layout.gutter;
  const shell = [
    styles.sheet,
    tablet && styles.sheetTablet,
  ];
  const pad = [
    padded && { paddingTop: metrics.sheetPadTop, paddingHorizontal: side },
    bleedRight && { paddingTop: metrics.sheetPadTop, paddingLeft: side, paddingRight: 0 },
    center && styles.center,
    center && styles.centerTop,
  ];
  if (!scroll) return <View style={[...shell, ...pad, styles.flex, style]}>{children}</View>;
  return (
    <View style={[...shell, styles.flex, style]}>
      <KeyboardScrollView
        style={styles.flex}
        contentContainerStyle={[...pad, { paddingBottom: contentBottom + metrics.sheetPadTop }]}
        refreshControl={refresh ? <Refresher refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} /> : undefined}
      >
        {children}
      </KeyboardScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowCenter: { alignSelf: "stretch" },
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  baseline: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  tabs: { marginTop: 4 },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    marginTop: -metrics.sheetOverlap,
  },
  sheetTablet: {
    borderTopLeftRadius: radius.modal,
    borderTopRightRadius: radius.modal,
    marginTop: -metrics.sheetOverlapTablet,
  },
  centerTop: { paddingTop: 96 },
});

export default Band;
