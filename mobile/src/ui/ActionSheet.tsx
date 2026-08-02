import { forwardRef, useImperativeHandle, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Check, type LucideIcon } from "lucide-react-native";

import { colors, radius, spacing, HIT_TARGET } from "../theme";
import { Sheet, type SheetRef } from "./Sheet";
import { Text } from "./Text";

export interface SheetAction {
  key: string;
  label: string;
  sublabel?: string;
  icon?: LucideIcon;
  /** Semantic token for the glyph and label. Defaults to the plain ink. */
  tone?: keyof typeof colors;
  /** Shows a tick — for "which column is this card in" style menus. */
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

export interface ActionSheetProps {
  title?: string;
  actions: SheetAction[];
  emptyMessage?: string;
}

/**
 * A sheet of actions — the phone's answer to a right-click menu and to a
 * "move to…" picker, which are the same widget with different rows.
 *
 * Distinct from `Select`: Select is a form field that owns a value and renders
 * a trigger. This owns nothing; a screen presents it imperatively and each row
 * does whatever it does.
 *
 * It dismisses itself before running the handler, so an action that opens
 * another sheet does not have to stack two of them.
 */
export const ActionSheet = forwardRef<SheetRef, ActionSheetProps>(
  function ActionSheet({ title, actions, emptyMessage }, ref) {
    const innerRef = useRef<SheetRef>(null);
    useImperativeHandle(ref, () => innerRef.current as SheetRef, []);

    return (
      <Sheet ref={innerRef} title={title}>
        <ScrollView style={styles.list} bounces={false}>
          {actions.map((action) => {
            const tone = action.tone ?? "text";
            return (
              <Pressable
                key={action.key}
                disabled={action.disabled}
                onPress={() => {
                  innerRef.current?.dismiss();
                  action.onPress();
                }}
                style={({ pressed }) => [
                  styles.row,
                  pressed && styles.rowPressed,
                  action.disabled && styles.rowDisabled,
                ]}
              >
                {action.icon ? (
                  <View style={styles.glyph}>
                    <action.icon size={20} color={colors[tone]} />
                  </View>
                ) : null}

                <View style={styles.text}>
                  <Text variant="body" color={tone}>
                    {action.label}
                  </Text>
                  {action.sublabel ? (
                    <Text variant="caption" color="textMuted" numberOfLines={1}>
                      {action.sublabel}
                    </Text>
                  ) : null}
                </View>

                {action.selected ? (
                  <Check size={20} color={colors.primary} />
                ) : null}
              </Pressable>
            );
          })}

          {!actions.length ? (
            <Text variant="secondary" style={styles.empty}>
              {emptyMessage ?? "Nothing to choose from."}
            </Text>
          ) : null}
        </ScrollView>
      </Sheet>
    );
  },
);

const styles = StyleSheet.create({
  list: { maxHeight: 420 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minHeight: HIT_TARGET + spacing[1],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  rowPressed: { backgroundColor: colors.surfacePressed },
  rowDisabled: { backgroundColor: colors.disabledBg },
  glyph: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1 },
  empty: { padding: spacing[4] },
});

export default ActionSheet;
