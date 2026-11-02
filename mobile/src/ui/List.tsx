import { isValidElement, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { ChevronRight } from "lucide-react-native";

import { colors, elevation, metrics, radius, type ColorKey } from "../theme";
import { Chip, type ChipProps } from "./Chip";
import { StatusBadge, type StatusBadgeProps } from "./StatusBadge";
import { Text } from "./Text";

// ----------------------------------------------------------------- ListGroup

/**
 * The white rounded group rows sit in (E `.lg`). The shadow is on the outer
 * view and the clip on the inner one: clipping the shadowed layer would flatten
 * it on iOS (the Card rule).
 */
export function ListGroup({ children, style, testID }: { children: ReactNode; style?: ViewStyle; testID?: string }) {
  return (
    <View testID={testID} style={[styles.group, elevation.whisper, style]}>
      <View style={styles.groupClip}>{children}</View>
    </View>
  );
}

/**
 * One cell of a ListGroup inside a FlatList (E `.lg`, virtualised): the first
 * cell rounds the top, the last the bottom. The clip is on the inner view, so
 * a SwipeRow's revealed blocks stay inside the corners.
 *
 * The whisper (0 1px 2px) is on the LAST cell only. Put on every cell, each
 * cell's blur spills up over the cell above and draws a seam between rows, and
 * a box-shadow cannot be limited to the sides. What E's single group shows of
 * it is the 1 px shadow under its bottom edge; the last cell draws exactly that.
 * ponytail: a whole group's faint 2 px side/top haze is not drawn; checked on a device (Task 39).
 */
export function ListGroupCell({ first, last, children }: { first: boolean; last: boolean; children: ReactNode }) {
  const corners = [first && styles.cellFirst, last && styles.cellLast];
  return (
    <View testID="list-cell" style={[styles.cell, last && elevation.whisper, ...corners]}>
      <View style={[styles.cellClip, ...corners]}>{children}</View>
    </View>
  );
}

// ------------------------------------------------------------------- ListRow

export type RowRight =
  | { text: string; tone?: "default" | "danger" | "success" | "warning" | "brand" }
  | { amount: string; muted?: boolean };

export interface ListRowProps {
  /** A StatusBadge spec (40 by default) or any node. */
  badge?: StatusBadgeProps | ReactNode;
  title: string;
  /** Rich title: this verb bold, then `title` regular ("**Escalated** to Neha", E 11 / T2). */
  titleVerb?: string;
  titleTone?: "default" | "muted" | "danger";
  /** `read` = an Inbox row already read (500). */
  titleWeight?: "strong" | "read";
  right?: RowRight;
  /** "C-1042" — prefixed to the meta line in muted tabular figures. */
  number?: string;
  meta?: string;
  chips?: ChipProps[];
  line3?: ReactNode;
  /** `top` = task rows (05): aligned to the first line, 12 padding. */
  align?: "center" | "top";
  trailing?: ReactNode;
  chevron?: boolean;
  selected?: boolean;
  unread?: boolean;
  /** The indigo unread dot at the end of line 2 (E 18). */
  unreadDot?: boolean;
  /** E 19 menu rows: a 15/600 title, padding 12 14. */
  menu?: boolean;
  /** Separator left inset: 66 after a 40 badge, 48 after a checkbox, 14 with none. Defaults from the badge. */
  separatorInset?: 66 | 48 | 14;
  /** The first row in a group has no separator; set this on it. */
  noSeparator?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  testID?: string;
  accessibilityLabel?: string;
}

const RIGHT_TONE: Record<NonNullable<Extract<RowRight, { text: string }>["tone"]>, ColorKey> = {
  default: "textSecondary",
  danger: "dangerText",
  success: "successText",
  warning: "warningText",
  brand: "primary",
};

const isBadgeSpec = (b: unknown): b is StatusBadgeProps =>
  !!b && typeof b === "object" && !isValidElement(b) && "tone" in b && "icon" in b;

/**
 * The one list row (E `.rw`): badge · title + right slot · meta + chips ·
 * optional third line. Every list in E is these inside a ListGroup.
 */
export function ListRow({
  badge, title, titleVerb, titleTone = "default", titleWeight = "strong", unreadDot = false, menu = false, right, number, meta, chips, line3,
  align = "center", trailing, chevron = false, selected = false, unread = false, separatorInset,
  noSeparator = false, onPress, onLongPress, testID, accessibilityLabel,
}: ListRowProps) {
  const inset = separatorInset ?? (badge ? metrics.sepInset.badge : metrics.sepInset.none);
  const fill = selected ? colors.primarySoft : unread ? colors.unreadTint : colors.surface;
  const titleColor: ColorKey = titleTone === "muted" ? "textSecondary" : titleTone === "danger" ? "dangerText" : "text";

  const body = (
    <>
      {noSeparator ? null : <View testID="row-separator" style={[styles.separator, { left: inset }]} />}
      {isBadgeSpec(badge) ? <StatusBadge {...badge} /> : badge}
      <View style={styles.content}>
        <View style={styles.line}>
          {titleVerb ? (
            <Text variant="text" color={titleColor} numberOfLines={1} style={styles.flex}>
              <Text variant="rowTitle" color={titleColor}>{titleVerb}</Text>
              {title ? ` ${title}` : null}
            </Text>
          ) : (
            <Text
              variant={menu ? "bodyStrong" : titleWeight === "read" ? "rowTitleRead" : "rowTitle"}
              color={titleColor}
              numberOfLines={1}
              style={styles.flex}
            >
              {title}
            </Text>
          )}
          {right ? (
            "amount" in right ? (
              <Text variant="amount" color={right.muted ? "textSecondary" : "text"}>{right.amount}</Text>
            ) : (
              <Text variant="label" tabular color={RIGHT_TONE[right.tone ?? "default"]}>{right.text}</Text>
            )
          ) : null}
        </View>
        {meta || number || chips?.length || unreadDot ? (
          <View style={[styles.line, styles.lineGap]}>
            <Text variant="meta" numberOfLines={1} style={styles.flex}>
              {number ? <Text variant="label" tabular color="textMuted">{`${number}${meta ? " · " : ""}`}</Text> : null}
              {meta}
            </Text>
            {chips?.map((c, i) => <Chip key={`${c.label ?? c.accessibilityLabel ?? ""}-${i}`} {...c} />)}
            {unreadDot ? <View testID="unread-dot" accessibilityLabel="Unread" style={styles.dot} /> : null}
          </View>
        ) : null}
        {line3 ? <View style={[styles.line, styles.lineGap]}>{line3}</View> : null}
      </View>
      {trailing}
      {chevron ? <ChevronRight size={18} color={colors.textMuted} /> : null}
    </>
  );

  const rowStyle = [styles.row, menu && styles.menu, align === "top" && styles.top, { backgroundColor: fill }];
  if (!onPress && !onLongPress) {
    return <View testID={testID} accessibilityLabel={accessibilityLabel} style={rowStyle}>{body}</View>;
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={selected ? { selected } : undefined}
      style={({ pressed }) => [...rowStyle, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

// --------------------------------------------------------------- GroupHeader

export interface GroupHeaderProps {
  /** An uppercase overline ("SORTED BY DEADLINE"). */
  label?: string;
  /** Or a bold title with an optional red count chip ("Needs you 3"). */
  title?: string;
  count?: number;
  /** A muted string on the right ("Updated 2:41 pm"). */
  right?: string;
  link?: { label: string; onPress: () => void };
  rightChip?: ChipProps;
  /** The first header on a sheet sits flush (margin-top 0). */
  first?: boolean;
}

/** The heading above a group (E `.gh-row`). */
export function GroupHeader({ label, title, count, right, link, rightChip, first = false }: GroupHeaderProps) {
  return (
    <View style={[styles.gh, first && styles.ghFirst]}>
      {title ? (
        <View style={styles.ghTitle}>
          <Text variant="groupTitle" accessibilityRole="header">{title}</Text>
          {count != null ? <Chip label={String(count)} tone="red" /> : null}
        </View>
      ) : (
        <Text variant="overline" accessibilityRole="header">{label}</Text>
      )}
      {link ? (
        <Pressable onPress={link.onPress} hitSlop={12} accessibilityRole="link" accessibilityLabel={link.label}>
          <Text variant="metaStrong" color="primary">{link.label}</Text>
        </Pressable>
      ) : rightChip ? (
        <Chip {...rightChip} />
      ) : right ? (
        <Text variant="label" tabular color="textMuted">{right}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { backgroundColor: colors.surface, borderRadius: radius.card },
  groupClip: { borderRadius: radius.card, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: metrics.rowGap,
    paddingVertical: metrics.rowPadV,
    paddingHorizontal: metrics.rowPadH,
  },
  top: { alignItems: "flex-start", paddingVertical: 12, paddingHorizontal: 12 },
  menu: { paddingVertical: 12 },
  dot: { width: metrics.dot, height: metrics.dot, borderRadius: metrics.dot / 2, backgroundColor: colors.primary },
  cell: { backgroundColor: colors.surface },
  cellClip: { overflow: "hidden" },
  cellFirst: { borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
  cellLast: { borderBottomLeftRadius: radius.card, borderBottomRightRadius: radius.card },
  pressed: { backgroundColor: colors.fieldTint },
  separator: { position: "absolute", top: 0, right: 0, height: 1, backgroundColor: colors.divider },
  content: { flex: 1, minWidth: 0 },
  line: { flexDirection: "row", alignItems: "center", gap: metrics.inlineGap, minWidth: 0 },
  lineGap: { marginTop: metrics.rowLineGap },
  flex: { flex: 1 },
  gh: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16, marginBottom: 8, marginHorizontal: 2 },
  ghFirst: { marginTop: 0 },
  ghTitle: { flexDirection: "row", alignItems: "center", gap: 8 },
});
