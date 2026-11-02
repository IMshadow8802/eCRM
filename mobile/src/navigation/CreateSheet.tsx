import { forwardRef, useImperativeHandle, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ChevronRight } from "lucide-react-native";

import { colors, moduleIcons, moduleTones, radius, spacing } from "../theme";
import { Sheet, StatusBadge, Text, type SheetRef } from "../ui";

export type CreateKind = "task" | "complaint" | "lead";

/** E 04b rows, in E's order: task, complaint, lead. */
export const CREATE_ROWS: Record<CreateKind, { title: string; meta: string; module: "tasks" | "complaints" | "leads"; short: string }> = {
  task: { title: "New task", meta: "Pick a workspace, assign it, add steps", module: "tasks", short: "Task" },
  complaint: { title: "New complaint", meta: "Log a customer issue; TAT starts now", module: "complaints", short: "Complaint" },
  lead: { title: "New lead", meta: "Capture an enquiry and its first follow-up", module: "leads", short: "Lead" },
};
export const CREATE_ORDER: CreateKind[] = ["task", "complaint", "lead"];

export interface CreateSheetProps {
  /** The kinds the role may add (`useAccess(m).add`), in any order. */
  kinds: CreateKind[];
  onPick: (kind: CreateKind) => void;
}

/**
 * "What do you want to start?" (E 04b): one tinted row per module the role
 * can add to. Opened from the band's "+ New" and the rail's "+".
 */
export const CreateSheet = forwardRef<SheetRef, CreateSheetProps>(function CreateSheet({ kinds, onPick }, ref) {
  const inner = useRef<SheetRef>(null);
  useImperativeHandle(ref, () => inner.current as SheetRef, []);
  return (
    <Sheet ref={inner} title="Create" subtitle="What do you want to start?" padded>
      <View style={styles.rows}>
        {CREATE_ORDER.filter((k) => kinds.includes(k)).map((k) => {
          const row = CREATE_ROWS[k];
          return (
            <Pressable
              key={k}
              onPress={() => {
                inner.current?.dismiss();
                onPick(k);
              }}
              accessibilityRole="button"
              accessibilityLabel={row.title}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <StatusBadge size={48} tone={moduleTones[row.module].badge} icon={moduleIcons[row.module].tile} />
              <View style={styles.flex}>
                <Text variant="cardTitle">{row.title}</Text>
                <Text variant="meta" numberOfLines={1}>{row.meta}</Text>
              </View>
              <ChevronRight size={18} color={colors.textMuted} />
            </Pressable>
          );
        })}
      </View>
      <Text variant="small" align="center" style={styles.foot}>Only the modules you can add to appear here.</Text>
    </Sheet>
  );
});

const styles = StyleSheet.create({
  rows: { gap: spacing[2] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: spacing[3],
    paddingHorizontal: 14,
    borderRadius: radius.card,
    backgroundColor: colors.surfaceMuted,
  },
  pressed: { transform: [{ scale: 0.985 }, { translateY: 1 }] },
  flex: { flex: 1, minWidth: 0 },
  foot: { marginTop: 14 },
});

export default CreateSheet;
