import { StyleSheet, View } from "react-native";
import { Check, ChevronsUp, CloudOff, RefreshCw, type LucideIcon } from "lucide-react-native";

import { badgeTones, colors, metrics, moduleIcons, moduleTones, radius, spacing, type UiModule } from "../theme";
import { Button } from "./Button";
import { Card } from "./Card";
import { ListGroup } from "./List";
import { StatusBadge } from "./StatusBadge";
import { FilterPillsSkeleton } from "./Tabs";
import { Text } from "./Text";

export interface EmptyStateProps {
  /** Picks the art's colour and default icon. Unset: slate. */
  module?: UiModule;
  icon?: LucideIcon;
  /** Accent badges on the art: a green check, a lilac escalation. */
  accents?: ("done" | "escalated")[];
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** In a list sheet: top-aligned, 96 under the sheet's edge (E 20a), not centred. */
  top?: boolean;
}

/**
 * The empty state (E 20a): a 132 rounded square in the module's colour with
 * its icon, optional accent badges, a title, a line, and one secondary button.
 */
export function EmptyState({ module = "more", icon, accents = [], title, message, actionLabel, onAction, top = false }: EmptyStateProps) {
  const { fill, ink } = badgeTones[moduleTones[module].badge];
  const Icon = icon ?? moduleIcons[module].tile;
  return (
    <View testID="empty-state" style={[styles.container, top && styles.top]}>
      <View style={styles.art}>
        <View testID="empty-art" style={[styles.artBox, { backgroundColor: fill }]}>
          <Icon size={56} strokeWidth={1.75} color={ink} />
        </View>
        {accents.includes("done") ? (
          <View style={styles.accentDone}>
            <StatusBadge size={52} tone="green" icon={Check} ring />
          </View>
        ) : null}
        {accents.includes("escalated") ? (
          <View style={styles.accentEsc}>
            <StatusBadge size={44} tone="lilac" icon={ChevronsUp} ring />
          </View>
        ) : null}
      </View>
      <Text variant="recordTitle" align="center" style={styles.title}>{title}</Text>
      {message ? <Text variant="text" color="textSecondary" align="center" style={styles.message}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} variant="secondary" size="sm" onPress={onAction} style={styles.action} />
      ) : null}
    </View>
  );
}

const W1 = [170, 140, 180, 156, 120, 150];
const W2 = [150, 170, 130, 160, 180, 140];
const CHIP_W = [46, 46, 56];

/**
 * Loading rows (E 20b): solid blocks in the exact ListRow geometry — no
 * shimmer, no fade. `pills` adds the pill-row skeleton above.
 */
export function SkeletonRows({ rows = 6, pills = false }: { rows?: number; pills?: boolean }) {
  return (
    <View accessibilityLabel="Loading" accessible accessibilityRole="progressbar" accessibilityState={{ busy: true }}>
      {pills ? <FilterPillsSkeleton /> : null}
      <ListGroup style={pills ? styles.afterPills : undefined}>
        {Array.from({ length: rows }, (_, i) => (
          <View key={i} testID="skeleton-row" style={styles.skRow}>
            {i > 0 ? <View style={styles.skSep} /> : null}
            <View style={styles.skBadge} />
            <View style={styles.flex}>
              <View style={styles.skLine}>
                <View style={[styles.sk14, { width: W1[i % 6] }]} />
                <View style={styles.flex} />
                <View style={[styles.sk12, { width: 56 + ((i * 4) % 17) }]} />
              </View>
              <View style={[styles.skLine, styles.skLine2]}>
                <View style={[styles.sk12, { width: W2[i % 6] }]} />
                <View style={styles.flex} />
                <View testID="skeleton-chip" style={[styles.skChip, { width: CHIP_W[i % 3] }]} />
                <View style={styles.skDot} />
              </View>
            </View>
          </View>
        ))}
      </ListGroup>
    </View>
  );
}

export interface ErrorCardProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

/** The load-failed card (E 20c): red cloud-off 72, title, line, one full-width retry. */
export function ErrorCard({
  title = "Could not load. Try again",
  message = "The server did not answer. Check your connection; your filters are kept.",
  onRetry,
  retryLabel = "Try again",
}: ErrorCardProps) {
  return (
    <Card style={styles.errorCard} gap={0}>
      <StatusBadge size={72} tone="red" icon={CloudOff} />
      <Text variant="sheetTitle" align="center" style={styles.errorTitle}>{title}</Text>
      <Text variant="text" color="textSecondary" align="center" style={styles.message}>{message}</Text>
      {onRetry ? <Button title={retryLabel} icon={RefreshCw} onPress={onRetry} fullWidth style={styles.retry} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing[8] },
  // The list body already pads sheetPadTop.
  top: { justifyContent: "flex-start", paddingTop: metrics.emptyTop - metrics.sheetPadTop },
  art: { width: metrics.emptyArt, height: metrics.emptyArt },
  artBox: {
    width: metrics.emptyArt,
    height: metrics.emptyArt,
    borderRadius: radius.emptyArt,
    alignItems: "center",
    justifyContent: "center",
  },
  accentDone: { position: "absolute", right: -12, bottom: -4 },
  accentEsc: { position: "absolute", left: -18, top: 8 },
  title: { marginTop: 28 },
  message: { marginTop: 6, maxWidth: 280 },
  action: { marginTop: spacing[5] },
  flex: { flex: 1 },
  afterPills: { marginTop: spacing[3] },
  skRow: { flexDirection: "row", alignItems: "center", gap: metrics.rowGap, paddingVertical: metrics.rowPadV, paddingHorizontal: metrics.rowPadH },
  skSep: { position: "absolute", top: 0, left: metrics.sepInset.badge, right: 0, height: 1, backgroundColor: colors.divider },
  skBadge: { width: 40, height: 40, borderRadius: radius.badge, backgroundColor: colors.skeleton },
  skLine: { flexDirection: "row", alignItems: "center", gap: metrics.inlineGap },
  skLine2: { marginTop: spacing[2] },
  sk14: { height: 14, borderRadius: 7, backgroundColor: colors.skeleton },
  sk12: { height: 12, borderRadius: 6, backgroundColor: colors.skeletonSoft },
  skChip: { height: 22, borderRadius: radius.chip, backgroundColor: colors.skeletonSoft },
  skDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.skeletonSoft },
  errorCard: { alignItems: "center", paddingTop: 28, paddingHorizontal: spacing[5], paddingBottom: spacing[5] },
  errorTitle: { marginTop: spacing[4] },
  retry: { marginTop: spacing[5] },
});

export default EmptyState;
