import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";

import { colors, radius, spacing } from "../theme";
import { Text } from "./Text";

export interface TimelineEntry {
  key: string;
  /** What happened, or what was said. Wraps freely. */
  title: string;
  /** Who and when — "Ayush · 2h ago". */
  meta?: string;
  icon?: LucideIcon;
  /** Semantic token for the node. Defaults to the brand colour. */
  tone?: keyof typeof colors;
  /**
   * Rendered in place of the coloured node — an Avatar, for a comment. Must be
   * NODE px and round, since it sits on the rail where the dot would be.
   */
  node?: ReactNode;
}

export interface TimelineProps {
  entries: TimelineEntry[];
}

const NODE = 24;
const RAIL = 2;

/**
 * A history log: one rail, a node per event, text alongside.
 *
 * Deliberately NOT cards. A card says "this is a thing you can act on"; a log
 * entry is a fact that already happened, and stacking twelve of them as
 * separate raised surfaces turns a timeline into a list of buttons. The rail
 * does the work a card border was doing — it groups the entries and shows they
 * are one sequence, in order.
 *
 * The line is drawn as two segments per row rather than one absolute overlay:
 * the row above's tail and this row's head meet at the node, so a row of any
 * height joins up without anyone measuring anything.
 */
export function Timeline({ entries }: TimelineProps) {
  return (
    <View>
      {entries.map((entry, i) => {
        const tone = entry.tone ?? "primary";
        const first = i === 0;
        const last = i === entries.length - 1;

        return (
          <View key={entry.key} style={styles.row}>
            <View style={styles.rail}>
              <View style={[styles.segment, styles.head, first && styles.hidden]} />
              {entry.node ?? (
                <View style={[styles.node, { backgroundColor: colors[tone] }]}>
                  {entry.icon ? (
                    <entry.icon size={13} color={colors.textOnBrand} />
                  ) : null}
                </View>
              )}
              {/* Flexes to whatever the body needs, so a two-line entry does
                  not break the rail. */}
              <View style={[styles.segment, styles.tail, last && styles.hidden]} />
            </View>

            <View style={styles.body}>
              <Text variant="body">{entry.title}</Text>
              {entry.meta ? (
                <Text variant="caption" color="textMuted">
                  {entry.meta}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing[3] },
  rail: { width: NODE, alignItems: "center" },
  segment: { width: RAIL, backgroundColor: colors.border },
  // Reaches from the top of the row up to the node.
  head: { height: spacing[1] },
  tail: { flex: 1 },
  hidden: { backgroundColor: colors.transparentBorder },
  node: {
    width: NODE,
    height: NODE,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  // The gap between entries lives here, not on the row, so the rail's tail
  // runs through it instead of stopping short.
  body: { flex: 1, gap: spacing[1], paddingBottom: spacing[5] },
});

export default Timeline;
