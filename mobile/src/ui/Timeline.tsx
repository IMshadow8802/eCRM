import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";

import { colors, radius, spacing, type BadgeTone } from "../theme";
import { StatusBadge } from "./StatusBadge";
import { Text } from "./Text";

export interface TimelineEntry {
  key: string;
  /** What happened, or what was said. Wraps freely. */
  title: string;
  /** The subline — "Ayush · 2h ago", "Stays on record, even if reopened". */
  meta?: string;
  /** Right-aligned time on the title line (E 09). */
  time?: string;
  /** E's node: a 28 StatusBadge (TAT: Started sky · Held butter · Due slate · Breached red). */
  badge?: { tone: BadgeTone; icon: LucideIcon };
  /** Title and time in `dangerText` (Breached). */
  danger?: boolean;
  /** retired (Task 40): the pre-E solid dot, by colour token. */
  icon?: LucideIcon;
  tone?: keyof typeof colors;
  /** Rendered in place of the node — an Avatar, for a comment. */
  node?: ReactNode;
  testID?: string;
  /** A reply: sits one step in, under the entry it answers. */
  indent?: boolean;
  /** Something that is gone (a deleted comment): muted and italic. */
  muted?: boolean;
  /** Long-press opens the entry's actions. Omit it when there are none. */
  onLongPress?: () => void;
}

export interface TimelineProps {
  entries: TimelineEntry[];
}

const NODE = 28;
/** retired (Task 40): the pre-E dot/avatar node, still used by the comment thread. */
const LEGACY_NODE = 24;
const RAIL = 2;

/**
 * A history log (E 09): a 28 badge per event on a 2 px track, title and time
 * alongside, a muted subline under it. The track runs from under one node to
 * the next and stops after the last. Not cards: a log entry is a fact, not a
 * thing to act on.
 */
export function Timeline({ entries }: TimelineProps) {
  return (
    <View>
      {entries.map((entry, i) => {
        const last = i === entries.length - 1;
        const size = entry.badge ? NODE : LEGACY_NODE;
        const node =
          entry.node ??
          (entry.badge ? (
            <StatusBadge size={28} tone={entry.badge.tone} icon={entry.badge.icon} />
          ) : (
            <View style={[styles.dot, { width: size, height: size, backgroundColor: colors[entry.tone ?? "primary"] }]}>
              {entry.icon ? <entry.icon size={14} color={colors.textOnBrand} /> : null}
            </View>
          ));
        return (
          <View key={entry.key} testID={entry.testID} style={[styles.row, entry.indent && styles.indent]}>
            <View style={[styles.rail, { width: size }]}>
              {node}
              {last ? null : (
                <View testID="timeline-track" style={[styles.track, { left: (size - RAIL) / 2, top: size + 2 }]} />
              )}
            </View>
            <Pressable
              style={[styles.body, last && styles.bodyLast]}
              disabled={!entry.onLongPress}
              onLongPress={entry.onLongPress}
            >
              <View style={styles.head}>
                {/* ponytail: no Inter italic is loaded, so iOS may draw it
                    upright; the muted colour is what reliably reads as "gone". */}
                <Text
                  variant="rowTitle"
                  color={entry.muted ? "textMuted" : entry.danger ? "dangerText" : "text"}
                  style={[styles.flex, entry.muted && styles.muted]}
                >
                  {entry.title}
                </Text>
                {entry.time ? (
                  <Text variant="label" tabular color={entry.danger ? "dangerText" : "textSecondary"}>{entry.time}</Text>
                ) : null}
              </View>
              {entry.meta ? <Text variant="small">{entry.meta}</Text> : null}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing[3] },
  indent: { marginLeft: LEGACY_NODE + spacing[3] },
  rail: { alignItems: "center" },
  track: { position: "absolute", bottom: 2, width: RAIL, backgroundColor: colors.track },
  dot: { borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, paddingBottom: 9, paddingTop: 4 },
  bodyLast: { paddingBottom: 11 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2] },
  flex: { flex: 1 },
  muted: { fontStyle: "italic" },
});

export default Timeline;
