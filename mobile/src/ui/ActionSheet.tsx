import { forwardRef, useImperativeHandle, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";

import { colors, radius, spacing, type BadgeTone } from "../theme";
import { Chip, type ChipProps } from "./Chip";
import { Radio } from "./ChoiceList";
import { Sheet, type SheetRef } from "./Sheet";

import { StatusBadge, type StatusBadgeProps } from "./StatusBadge";
import { Text } from "./Text";

export interface SheetAction {
  key: string;
  label: string;
  sublabel?: string;
  /** A plain icon in a 36 circle (pre-E rows). Prefer `badge`. */
  icon?: LucideIcon;
  /** E: a 36 badge in a status tone. */
  badge?: { tone: BadgeTone; icon: LucideIcon };
  /** Semantic token for the label (and a plain icon). `danger` also tints the selected row. */
  tone?: keyof typeof colors;
  /** "Current" and the like. */
  chip?: ChipProps;
  /** Set on every row of a picker ("which column is this card in"): rows then end in a radio. */
  selected?: boolean;
  disabled?: boolean;
  /** For a row whose label repeats elsewhere on screen (e.g. a sheet's own title). */
  accessibilityLabel?: string;
  onPress: () => void;
}

export interface ActionSheetProps {
  title?: string;
  subtitle?: string;
  badge?: Pick<StatusBadgeProps, "tone" | "icon">;
  actions: SheetAction[];
  emptyMessage?: string;
}

/**
 * A sheet of actions or of choices (E §3.15): ChoiceList rows — no
 * separators, a 36 badge, a `bodyStrong` label, an optional chip or note,
 * then a radio when the rows are a pick. It dismisses itself before running
 * the handler, so an action that opens another sheet does not stack two.
 */
export const ActionSheet = forwardRef<SheetRef, ActionSheetProps>(function ActionSheet(
  { title, subtitle, badge, actions, emptyMessage },
  ref,
) {
  const innerRef = useRef<SheetRef>(null);
  useImperativeHandle(ref, () => innerRef.current as SheetRef, []);
  const picker = actions.some((a) => a.selected != null);

  return (
    <Sheet ref={innerRef} title={title} subtitle={subtitle} badge={badge} padded>
      <ScrollView style={styles.list} bounces={false}>
        {actions.map((action) => {
          const tone = action.tone ?? "text";
          const on = !!action.selected;
          const danger = tone === "danger" || tone === "dangerText";
          return (
            <Pressable
              key={action.key}
              disabled={action.disabled}
              accessibilityRole={picker ? "radio" : "menuitem"}
              accessibilityState={{ disabled: !!action.disabled, ...(picker ? { checked: on } : null) }}
              accessibilityLabel={action.accessibilityLabel ?? action.label}
              onPress={() => {
                innerRef.current?.dismiss();
                action.onPress();
              }}
              style={({ pressed }) => [
                styles.row,
                on && (danger ? styles.onDanger : styles.on),
                pressed && !on && styles.pressed,
                action.disabled && styles.disabled,
              ]}
            >
              {action.badge ? (
                <StatusBadge size={36} tone={action.badge.tone} icon={action.badge.icon} />
              ) : action.icon ? (
                <View style={styles.glyph}>
                  <action.icon size={18} color={colors[danger ? "danger" : tone === "text" ? "textSecondary" : tone]} />
                </View>
              ) : null}
              <View style={styles.text}>
                <Text variant="bodyStrong" color={danger ? "dangerText" : tone}>{action.label}</Text>
                {action.sublabel ? <Text variant="small" numberOfLines={1}>{action.sublabel}</Text> : null}
              </View>
              {action.chip ? <Chip {...action.chip} /> : null}
              {picker ? <Radio on={on} /> : null}
            </Pressable>
          );
        })}
        {!actions.length ? (
          <Text variant="meta" style={styles.empty}>{emptyMessage ?? "Nothing to choose from."}</Text>
        ) : null}
      </ScrollView>
    </Sheet>
  );
});

const styles = StyleSheet.create({
  list: { maxHeight: 420 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[3], paddingVertical: 7, paddingHorizontal: spacing[1], borderRadius: radius.badgeLg },
  on: { backgroundColor: colors.fieldTint },
  onDanger: { backgroundColor: colors.dangerRowTint },
  pressed: { backgroundColor: colors.fieldTint },
  disabled: { backgroundColor: colors.disabledBg },
  glyph: { width: 36, height: 36, borderRadius: radius.full, backgroundColor: colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
  text: { flex: 1 },
  empty: { padding: spacing[4] },
});

export default ActionSheet;
